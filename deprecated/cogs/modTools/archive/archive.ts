import { messageToExtra } from "@utils/failToDetail";
import { IHashMap } from "../../../types/Types";
import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../../plugin";
import { Message, Guild, TextChannel, User, GuildMember } from "discord.js";
import { EmbedType, IEmbedOptionsField, resolveGuildChannel, resolveGuildMember, IEmbed } from "@utils/utils";
import { generateLocalizedEmbed, getUserLanguage, localizeForUser, getUserTimezone } from "@utils/ez-i18n";
import { ArchiveDBController, convertToDBMessage, IDBMessage, IEmulatedContents } from "./dbController";
import { getPreferenceValue, setPreferenceValue } from "@utils/guildPreferences";
import { createConfirmationMessage } from "@utils/interactive";
import { parse as parseCmd, ICommandParseResult } from "@utils/command";
import * as getLogger from "loggy";
import { replaceAll } from "@utils/text";
import { DateTime } from "luxon";

const PREFIX = "!archive";
const MSG_PREFIX = "!message";
const ARCHIVE_ENABLING_PREFIX = "!enable_archive";
const PREFIXES = [PREFIX, MSG_PREFIX, ARCHIVE_ENABLING_PREFIX];
const POSSIBLE_TARGETS = ["user", "channel", "guild"];
const ENABLED_PROP = "features:archive:enabled";
// targetting:
//  user & resolvableUser
//  guild & resolvableUser
//  channel & resolvableChannel & resolvableUser?
const SNOWFLAKE_REGEXP = /^[0-9]{18}$/;
const NUMBER_REGEXP = /^[0-9]{1,5}$/;
const TARGETTING = Object.freeze({
	RESOLVABLE_USER: {
		MENTION: /^<@!?([0-9]{18})>$/,
	},
	RESOLVABLE_CHANNEL: {
		MENTION: /^<#([0-9]{18})>$/
	}
});

const DEFAULT_LENGTH = 50; // lines per file
const MESSAGES_LIMIT = 5000;
const DEFAULT_ENABLED_STATE = false; // true = enabled
const SNOWFLAKE_TO_DATE = (id: string) => (id ? (+id / 4194304) + 1420070400000 : 0);

interface IModToolsArchiveOptions {
	/**
	 * Lists of globally banned keycases
	 */
	banned?: {
		/**
		 * Array of Discord IDs with banned authors
		 */
		authors?: string[];
		/**
		 * Array of Discord IDs with banned channels
		 */
		channels?: string[];
		/**
		 * Array of Discord IDs with banned guilds
		 */
		guilds?: string[];
	};
	/**
	 * Use true if you want to log bot's messages
	 */
	bots: boolean;
	/**
	 * Use true if you want to log any messages in DM
	 */
	dms: boolean;
}

class ModToolsArchive extends Plugin implements IModule {
	public get signature() {
		return "snowball.modtools.archive";
	}

	private readonly _log = getLogger("ModTools:Archive");
	private readonly _options: IModToolsArchiveOptions;
	private _controller: ArchiveDBController;
	private readonly _enabledAt: IHashMap<boolean> = Object.create(null);

	constructor(options: IModToolsArchiveOptions) {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		}, true);
		this._options = {
			bots: false,
			dms: true,
			...options
		};
		this._log("info", "The settings are:", options);
	}

	private async _onMessage(msg: Message) {
		if (this._options.bots !== undefined && !this._options.bots && msg.author.bot) { return; }

		if (this._options.banned) {
			if (this._options.banned.authors && this._options.banned.authors.includes(msg.author.id)) {
				return;
			} else if (this._options.banned.channels && this._options.banned.channels.includes(msg.channel.id)) {
				return;
			} else if (this._options.banned.guilds && !!msg.guild && this._options.banned.guilds.includes(msg.guild.id)) {
				return;
			}
		}

		try {
			await this._recordMessage(msg);
		} catch (err) {
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			this._log("err", "Failed to push message", err);
		}

		try {
			await this.handleCommand(msg);
		} catch (err) {
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			this._log("err", "Handling commands failure", err);
		}
	}

	private async handleCommand(msg: Message) {
		const prefix = PREFIXES.find(prefix => msg.content.startsWith(prefix));
		if (!prefix) { return; }

		const parsed = parseCmd(msg.content);

		switch (prefix) {
			case PREFIX: return msg.member.permissions.has("MANAGE_MESSAGES") && this.subcmd_archive(msg, parsed);
			case MSG_PREFIX: return this.subcmd_message(msg, parsed);
			case ARCHIVE_ENABLING_PREFIX: return msg.member.permissions.has(["MANAGE_GUILD", "MANAGE_MESSAGES"]) && this.subcmd_archiveStatus(msg, parsed);
		}
	}

	private async subcmd_message(msg: Message, parsed: ICommandParseResult) {
		const msgId = parsed.subCommand;
		if (msg.content === PREFIX || !msgId) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "ARCHIVE_MESSAGE_HELP",
					formatOptions: {
						prefix: MSG_PREFIX
					}
				})
			});
		}

		if (!SNOWFLAKE_REGEXP.test(msgId)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_INVALID_ID")
			});
		}

		const message = await this._controller.getMessage(msgId);

		if (!message) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_NOTFOUND")
			});
		}

		if (message.guildId !== msg.guild.id) { return; }

		const channel = <TextChannel> await this._resolveGuildChannel(message.channelId, msg.guild);

		if (!channel) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_CHANNELNOTFOUND")
			});
		}

		if (!channel.permissionsFor(msg.member)!.has(["READ_MESSAGE_HISTORY", "VIEW_CHANNEL"])) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_NOPERMISSIONS")
			});
		}

		const originalMessage = await (async () => {
			try {
				return channel.messages.fetch(message.messageId);
			} catch (err) {
				return undefined;
			}
		})();

		if (!originalMessage && !msg.member.permissions.has("MANAGE_MESSAGES", true) && !channel.permissionsFor(msg.member)!.has("MANAGE_MESSAGES", true)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_NOPERMISSIONS@REMOVED")
			});
		}

		const author = (originalMessage && originalMessage.author) || await this._resolveUserTarget(message.authorId, msg.guild);
		const member = (originalMessage && originalMessage.member) || msg.guild.member(author);
		const other = message.other ? <IEmulatedContents> JSON.parse(message.other) : undefined;
		const date = originalMessage ? originalMessage.createdAt.toISOString() : new Date(SNOWFLAKE_TO_DATE(message.messageId)).toISOString();

		await msg.channel.send({
			embed: <IEmbed> {
				author: {
					icon_url: author ? author.displayAvatarURL({ format: "webp", size: 128 }) : undefined,
					name: author ? `${author.tag}${member && member.nickname ? ` (${member.displayName})` : ""}` : message.authorId
				},
				color: member ? member.displayColor : undefined,
				title: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_TITLE", {
					id: message.messageId
				}),
				description: message.content ? message.content : undefined,
				image: other && other.attachments.length === 1 ? {
					url: other.attachments[0].file.url
				} : undefined,
				fields: other && ((other.attachments && other.attachments.length > 1) || (other.embeds && other.embeds.length > 0)) ? await (async () => {
					const fields: IEmbedOptionsField[] = [];

					if (other.embeds && other.embeds.length > 0) {
						fields.push({
							inline: true,
							name: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_EMBEDS_TITLE"),
							value: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_EMBEDS_VALUE", {
								count: other.embeds.length
							})
						});
					}

					if (other.attachments && other.attachments.length > 1) {
						fields.push({
							inline: true,
							name: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_ATTACHMENTS_TITLE"),
							value: await (async () => {
								let str = "";
								for (const attachment of other.attachments) {
									str += `${await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_ATTACHMENTS_VALUE", {
										link: attachment.file.url,
										fileName: attachment.file.name
									})}\n`;
								}

								return str;
							})()
						});
					}

					return fields;
				})() : undefined,
				footer: {
					text: `#${channel.name}`,
					icon_url: msg.guild.iconURL({ format: "webp", size: 128 }) || undefined
				},
				timestamp: date
			}
		});

		{
			let l = 0;

			if (!other || !other.embeds || (l = other.embeds.length) < 1) {
				return;
			}
	
			for (let i = 0; i < l; i++) {
				const embed = other.embeds[i];

				await msg.channel.send(await localizeForUser(msg.member, "ARCHIVE_MESSAGE_EMBEDMESSAGE_DESCRIPTION", {
					id: message.messageId
				}), { embed: <any> embed });
			}
		}
	}

	private async subcmd_archive(msg: Message, parsed: ICommandParseResult) {
		if (msg.content === PREFIX) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "ARCHIVE_HELP",
					formatOptions: {
						limit: MESSAGES_LIMIT,
						prefix: PREFIX
					}
				})
			});
		}

		const target = parsed.subCommand;

		if (!target) { return; } // ???

		if (!POSSIBLE_TARGETS.includes(target.toLowerCase())) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "ARCHIVE_UNKNOWN_TARGET",
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
		}

		let foundMessages: IDBMessage[] | undefined = undefined;
		let lines = DEFAULT_LENGTH;
		let offset = 0;

		const args = parsed.arguments;

		if (args) {
			for (let i = args.length - 1, c = 0; c < 3 && i >= 0; i-- , c++) {
				const arg = args[i].value;

				if (!NUMBER_REGEXP.test(arg)) { break; }

				switch (c) {
					case 0: {
						lines = parseInt(arg, 10);

						if (lines > MESSAGES_LIMIT) {
							return msg.channel.send({
								embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
									key: "ARCHIVE_INVALID_LENGTH",
									formatOptions: {
										limit: MESSAGES_LIMIT
									}
								})
							});
						}
					} break;
					case 1: {
						offset = parseInt(arg, 10);
					} break;
				}

				args.splice(-1, 1);
			}
		}

		const caches: {
			users: IHashMap<User>,
			channels: IHashMap<TextChannel>
		} = { users: Object.create(null), channels: Object.create(null) };

		switch (target) {
			case "user": {
				if (!args || args.length === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
							key: "ARCHIVE_REQUIRES_ARGS_USER",
							formatOptions: {
								prefix: PREFIX
							}
						})
					});
				}

				const resolvedTargets: string[] = [];

				for (let i = 0, l = args.length; i < l; i++) {
					const target = args[i];

					try {
						resolvedTargets.push(
							(await this._resolveUserTarget(
								target.value, msg.guild
							)).id
						);
					} catch (err) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Error, msg.member, {
									key: "ARCHIVE_ERR_RESOLVING_USER",
									formatOptions: {
										search: replaceAll(target.value, "``", "''")
									}
								}
							)
						});
					}
				}

				foundMessages = await this._controller.search({
					guildId: msg.guild.id,
					authorId: resolvedTargets.length === 1 ? resolvedTargets[0] : resolvedTargets
				}, lines, offset);
			} break;
			case "guild": {
				foundMessages = await this._controller.search({
					guildId: msg.guild.id
				}, lines, offset);
			} break;
			case "channel": {
				const channels: string[] = [];
				const users: string[] = [];

				if (args && args.length > 0) {
					for (let i = 0, l = args.length; i < l; i++) {
						const target = args[i];

						if (target.value.startsWith("u:")) {
							try {
								const user = await this._resolveUserTarget(target.value.slice("u:".length).trim(), msg.guild);
								caches.users[user.id] = user;
								users.push(user.id);
							} catch (err) {
								return msg.channel.send({
									embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
										key: "ARCHIVE_ERR_RESOLVING_USER",
										formatOptions: {
											search: replaceAll(target.value, "``", "''")
										}
									})
								});
							}
						} else {
							try {
								const channel = await this._resolveGuildChannel(target.value, msg.guild);
								if (!channel) {
									throw new Error("No channel returned");
								}

								if (!(channel instanceof TextChannel)) {
									return await msg.channel.send({
										embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
											key: "ARCHIVE_ERR_RESOLVING_CHANNEL_TYPEINVALID",
											formatOptions: {
												argument: replaceAll(target.value, "``", "''")
											}
										})
									});
								}
								caches.channels[channel.id] = channel;
								channels.push(channel.id);
							} catch (err) {
								return msg.channel.send({
									embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
										key: "ARCHIVE_ERR_RESOLVING_CHANNEL",
										formatOptions: {
											search: replaceAll(target.value, "``", "''")
										}
									})
								});
							}
						}
					}
				}

				foundMessages = await this._controller.search({
					guildId: msg.guild.id,
					channelId: channels.length > 0 ? (channels.length === 1 ? channels[0] : channels) : msg.channel.id,
					authorId: users.length > 0 ? users : undefined
				}, lines, offset);
			} break;
			default: {
				this._log("err", "Unknown target found", target);

				return;
			}
		}

		if (foundMessages && foundMessages.length > 0) { // easy filtering from sniffing other channels
			foundMessages = foundMessages.filter((m) => {
				const cachedChannel = (caches.channels[m.channelId] !== undefined ? caches.channels[m.channelId] : undefined);

				const channel = cachedChannel === undefined ? (caches.channels[m.channelId] = <TextChannel> msg.guild.channels.get(m.channelId) || null) : undefined;

				if (channel === null || channel === undefined) {
					return true;
				}

				const userPerms = channel.permissionsFor(msg.member);

				return userPerms ? 
					userPerms.has(["READ_MESSAGE_HISTORY", "VIEW_CHANNEL"]) :
					false;
			});
		} else {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "ARCHIVE_ERR_NOTHINGFOUND")
			});
		}

		const result = await this._messagesToString(foundMessages, caches.users, msg.member);

		return msg.channel.send({
			content: await localizeForUser(msg.member, "ARCHIVE_DONE", { lines: foundMessages.length }),
			files: [{
				attachment: Buffer.from(result),
				name: `archive_${Date.now()}.txt`
			}]
		});
	}

	private async _resolveUserTarget(resolvableUser: string, guild: Guild) {
		{
			const res = TARGETTING.RESOLVABLE_USER.MENTION.exec(resolvableUser);
			if (res && res.length === 2) {
				resolvableUser = res[1];
				// i removed returning as we really need to check if this user is exists
				// next stages will check if this user in the guild and then checks if it at least exists in discord api
				// then it returns ID, that's I guess good practice of resolving
			}
		}

		const resolvedMember = await resolveGuildMember(resolvableUser, guild, {
			strict: false,
			caseStrict: false
		});

		if (resolvedMember) { return resolvedMember.user; }

		if (!SNOWFLAKE_REGEXP.test(resolvableUser)) {
			throw new Error("Bad ID");
		}

		return ($discordBot.users.fetch(resolvableUser));
	}

	private async _resolveGuildChannel(resolvableChannel: string, guild: Guild) {
		{
			const res = TARGETTING.RESOLVABLE_CHANNEL.MENTION.exec(resolvableChannel);
			if (res && res.length === 2) {
				resolvableChannel = res[1];
			}
		}

		const resolvedChannel = resolveGuildChannel(resolvableChannel, guild, {
			strict: false,
			types: ["text"],
			possibleMention: true
		});

		if (resolvableChannel) { return resolvedChannel; }

		throw new Error("Channel not found");
	}

	private async _messagesToString(messages: IDBMessage[], cache: IHashMap<User | null> = Object.create(null), caller: GuildMember) {
		let str = "";

		const language = await getUserLanguage(caller);

		const intlFormatter = new Intl.DateTimeFormat(
			language, {
				...DateTime.DATETIME_FULL_WITH_SECONDS,
				timeZone: await getUserTimezone(caller),
				timeZoneName: "short"
			}
		);

		for (let i = 0, l = messages.length; i < l; i++) {
			const messageEntry = messages[i];
			const parsedDate = SNOWFLAKE_TO_DATE(messageEntry.messageId);

			let author = cache[messageEntry.authorId];
			if (author === undefined) {
				author = cache[messageEntry.authorId] = await (async () => {
					try {
						return $discordBot.users.fetch(messageEntry.authorId);
					} catch (err) {
						return null;
					}
				})();
			}

			str += $localizer.getFormattedString(language, "ARCHIVE_ITEM", {
				sentAt: intlFormatter.format(parsedDate),
				channelId: messageEntry.channelId,
				authorId: messageEntry.authorId,
				messageId: messageEntry.messageId,
				author: author ? author.tag : messageEntry.authorId,
				content: messageEntry.content
			});

			if (messageEntry.other) {
				const parsedContent = <IEmulatedContents> JSON.parse(messageEntry.other);

				if (parsedContent.attachments) {
					str += "\r\n";
					const entryTypeStr = `[${$localizer.getString(language, "ARCHIVE_ITEM_ENTRY_TYPE:ATTACHMENT")}]`;
					for (const attachment of parsedContent.attachments) {
						str += "  ";
						str += $localizer.getFormattedString(language, "ARCHIVE_ITEM_ENTRY:ATTACHMENT", {
							"file.name": attachment.file.name,
							"file.url": attachment.file.url,
							"file.id": attachment.id,
							type: entryTypeStr
						});
						str += "\r\n";
					}
				}

				if (parsedContent.embeds) {
					str += "\r\n";
					const entryTypeStr = `[${$localizer.getString(language, "ARCHIVE_ITEM_ENTRY_TYPE:EMBED")}]`;
					for (const embed of parsedContent.embeds) {
						str += "  ";
						str += $localizer.getFormattedString(language, "ARCHIVE_ITEM_ENTRY:EMBED", {
							type: entryTypeStr,
							json: JSON.stringify(embed)
						});
						str += "\r\n";
					}
				}
			}
			str += "\r\n";
		}

		return str;
	}

	private async subcmd_archiveStatus(msg: Message, parsed: ICommandParseResult) {
		const isEnabledAlready = await this._isEnabledAt(msg.guild);
		let newStatus = false;
		switch (parsed.subCommand) {
			case "true": { newStatus = true; } break;
			case "false": { newStatus = false; } break;
			default: {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
						key: "ARCHIVE_STATUS_INVALIDARG",
						formatOptions: {
							status: isEnabledAlready
						}
					})
				});
			}
		}

		if (isEnabledAlready === newStatus) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "ARCHIVE_STATUS_ALREADY",
					formatOptions: {
						status: isEnabledAlready
					}
				})
			});
		}

		const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Warning, msg.member, `ARCHIVE_STATUS_CONFIRMATION_${newStatus ? "ENABLING" : "DISABLING"}`), msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "ARCHIVE_STATUS_NOTCONFIRMED")
			});
		}

		await setPreferenceValue(msg.guild, ENABLED_PROP, newStatus);
		this._enabledAt[msg.guild.id] = newStatus;

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "ARCHIVE_STATUS_CHANGED",
				formatOptions: {
					status: await this._isEnabledAt(msg.guild) // fetching and using
				}
			})
		});
	}

	private async _isEnabledAt(guild: Guild | "dm"): Promise<boolean> {
		if (!guild) { return false; }
		if (guild === "dm") { return this._options.dms; }

		const cachedStatus = this._enabledAt[guild.id];
		if (typeof cachedStatus === "boolean") { return cachedStatus; }

		const dbStatus = <boolean | undefined> await getPreferenceValue(guild, ENABLED_PROP, true);
		if (typeof dbStatus === "boolean") { return this._enabledAt[guild.id] = dbStatus; }

		return this._enabledAt[guild.id] = DEFAULT_ENABLED_STATE;
	}

	private async _recordMessage(msg: Message) {
		if (!(await this._isEnabledAt(msg.channel.type === "dm" ? "dm" : msg.guild))) { return; }
		const payload = convertToDBMessage(msg);

		return this._controller.insertMessage(payload);
	}

	public async init() {
		this._controller = new ArchiveDBController();
		await this._controller.init();
		this.handleEvents();
	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}

module.exports = ModToolsArchive;
