import { Whitelist } from "../whitelist/whitelist";
import * as ModLoader from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "../plugin";
import * as djs from "discord.js";
import * as utils from "@utils/utils";
import * as db from "@utils/db";
import { parse as parseCmd } from "@utils/command";
import * as i18n from "@utils/ez-i18n";
import { EmbedType, sleep, IEmbedOptionsField, IEmbed } from "@utils/utils";
import * as baseService from "./baseService";
import { createConfirmationMessage } from "@utils/interactive";
import { command } from "@utils/help";
import { INullableHashMap, Possible } from "../../types/Types";
import { messageToExtra } from "@utils/failToDetail";
import { isPremium } from "@utils/premium";
import * as getLogger from "loggy";
import { ModuleBase } from "@sb-types/ModuleLoader/ModuleBase";
import * as ModLoaderInterfaces from "@sb-types/ModuleLoader/Interfaces";

const PREFIX = "!streams";
const MAX_NOTIFIED_LIFE = 86400000; // ms
const SUBS_PER_PAGE = 20;

const TABLE = {
	subscriptions: "sn_subscriptions",
	settings: "sn_settings",
	notifications: "sn_notifications"
};

const SHARDING_MESSAGE_TYPES = {
	SUBSCRIBE: "streams:sub",
	UNSUBSCRIBE: "streams:free",
	PUSH: "streams:push"
};

const USER_SUBSCRIBER_REGEXP = /^u([0-9]{16,18})$/;
const GUILD_SUBSCRIBER_REGEXP = /^([0-9]{16,20})($|:[0-9]{16,20}$)/;

interface ILimits {
	guilds: number;
	users: number;
}

interface INotificationsModuleSettings {
	/**
	 * Streaming services
	 */
	services: ModLoaderInterfaces.IModuleInfo[];
	/**
	 * Limits for non-premium and not-partnered users
	 */
	limits: ILimits;
	/**
	 * Same Server Subscription limit.
	 * How many subscriptions to the one streamer server could have at the same time.
	 */
	sss_limit: number;
}

const LOCALIZED = (str: string) => `STREAMING_${str.toUpperCase()}`;
const HELP_CATEGORY = "HELPFUL";
const DEFAULT_LIMITS: ILimits = { users: 20, guilds: 20 };
const DEFAULT_SSS_LIMIT = 3; // same server sub limit

function rightsCheck(member: djs.GuildMember) {
	return member.permissions.has(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.permissions.has(["ADMINISTRATOR"]) || member.id === $botConfig.botOwner;
}

function helpCheck(msg: djs.Message) {
	return msg.channel.type === "text" && rightsCheck(msg.member);
}

@command(HELP_CATEGORY, `${PREFIX.slice(1)}`, `loc:${LOCALIZED("META_LIST")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_LIST_ARG0_DESC",
		optional: true
	},
	"loc:STREAMING_META_LIST_ARG1": {
		description: "loc:STREAMING_META_LIST_ARG1_DESC",
		optional: false
	}
}, (msg) => msg.channel.type === "dm" ? true : rightsCheck(msg.member))
@command(HELP_CATEGORY, `${PREFIX.slice(1)} add`, `loc:${LOCALIZED("META_ADD")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} subscribe`, `loc:${LOCALIZED("META_SUBSCRIBE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	}
})
@command(HELP_CATEGORY, `${PREFIX.slice(1)} remove`, `loc:${LOCALIZED("META_REMOVE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_REMOVE_ARG1": {
		description: "loc:STREAMING_META_REMOVE_ARG1_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} unsubscribe`, `loc:${LOCALIZED("META_UNSUBSCRIBE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_REMOVE_ARG1": {
		description: "loc:STREAMING_META_REMOVE_ARG1_DESC",
		optional: false
	}
})
@command(HELP_CATEGORY, `${PREFIX.slice(1)} edit`, `loc:${LOCALIZED("META_EDIT")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	},
	"loc:STREAMING_META_EDIT_ARG2": {
		description: "loc:STREAMING_META_EDIT_ARG2_DESC",
		optional: false
	},
	"loc:STREAMING_META_EDIT_ARG3": {
		description: "loc:STREAMING_META_EDIT_ARG3_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} set_channel`, `loc:${LOCALIZED("META_SETCHANNEL")}`, {
	"loc:STREAMING_META_SETCHANNEL_ARG0": {
		description: "loc:STREAMING_META_SETCHANNEL_ARG0_DESC",
		optional: false
	}
}, helpCheck)
export default class StreamNotifications extends Plugin implements ModLoaderInterfaces.IModule {
	public get signature() {
		return "snowball.features.stream_notifications";
	}

	private readonly log = getLogger("StreamNotifications");
	private readonly db = db.getDB();
	private readonly servicesLoader: ModLoader.ModuleLoader;
	private readonly servicesList: INullableHashMap<ModLoaderInterfaces.IModuleInfo>;
	private whitelistModule: ModuleBase<Whitelist>;
	private readonly options: INotificationsModuleSettings;

	constructor(options: INotificationsModuleSettings) {
		super({
			"message": (msg: djs.Message) => this._onMessage(msg)
		}, true);

		this.servicesList = ModLoader.convertToModulesMap(options.services);

		this.servicesLoader = new ModLoader.ModuleLoader({
			name: "StreamNotifications:Services",
			basePath: `${__dirname}/services/`,
			registry: this.servicesList,
			defaultSet: []
		});

		if (!options.limits) {
			options.limits = DEFAULT_LIMITS;
		} else {
			for (const [key, defaultValue] of Object.entries(DEFAULT_LIMITS)) {
				if (typeof options.limits[key] !== "number") {
					options.limits[key] = DEFAULT_LIMITS[key];
				}
			}
		}

		if (options.sss_limit != null) {
			options.sss_limit = Math.max(0, Number(options.sss_limit));
		} else {
			options.sss_limit = DEFAULT_SSS_LIMIT;
		}

		this.options = options;
	}

	// =======================================
	//  Message handling
	// =======================================

	private async _onMessage(msg: djs.Message) {
		if (!msg.content.startsWith(PREFIX)) { return; }
		const cmd = parseCmd(msg.content);
		const args = cmd.arguments ? cmd.arguments.only("value") : null;
		try {
			switch (cmd.subCommand) {
				case "edit": await this.subcmd_edit(msg, args); break;
				case "add": await this.subcmd_add(msg, args, "guild"); break;
				case "remove": await this.subcmd_remove(msg, args, "guild"); break;
				case "set_channel": await this.subcmd_setChannel(msg, args); break;
				case "subscribe": await this.subcmd_add(msg, args, "user"); break;
				case "unsubscribe": await this.subcmd_remove(msg, args, "user"); break;
				default: await this.subcmd_list(msg, cmd.subCommand, args); break;
			}
		} catch (err) {
			this.log("err", `Error starting command "${msg.content}"`, err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.author, LOCALIZED("CMD_ERROR"))
			});
		}
	}


	// =======================================
	// Command handling
	// =======================================

	// #region Subcommands

	private async subcmd_setChannel(msg: djs.Message, args: string[] | null) {
		// !streams set_channel <#228174260307230721>
		// args at this point: ["<#228174260307230721>"]

		if (msg.channel.type !== "text") { return; }

		if (!rightsCheck(msg.member)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});

			return;
		}

		if (!args || args.length !== 1) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("SETCHANNEL_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});

			return;
		}

		const settings = await this._createOrGetSettings(msg.guild);

		if (args[0] !== "NONE") {
			const matches = args[0].match(/[0-9]+/);
			const channelId = matches ? matches[0] : undefined;
			if (!channelId) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGIDFORMAT"))
				});

				return;
			}

			// trying to find this channel?

			const channel = msg.guild.channels.get(channelId);
			if (!channel) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_CHANNELNOTFOUND"))
				});

				return;
			}

			if (channel.type !== "text") {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGCHANNELTYPE"))
				});

				return;
			}

			settings.channelId = channel.id;
		} else {
			settings.channelId = null;
		}

		await this._updateSettings(settings);

		await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("SETCHANNEL_DONE"))
		});
	}

	private async subcmd_edit(msg: djs.Message, args: string[] | null) {
		// !streams edit YouTube, ID, mention_everyone, true
		// args at this point: ["YouTube", "ID", "mention_everyone", "true"]

		if (msg.channel.type !== "text") { return; }

		if (!rightsCheck(msg.member)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});

			return;
		}

		if (!args || args.length !== 4) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("EDIT_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});

			return;
		}

		if (args[2] === "mention_everyone") {
			if (!["true", "false"].includes(args[3])) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_INVALIDARG0"))
				});
			}
		} else {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_INVALIDARG"))
			});
		}

		// find this subscription to ensure that is exists

		const subscription = await this._findSubscription({
			provider: args[0].toLowerCase(),
			uid: args[1]
		});

		if (!subscription) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_SUBNOTFOUND"))
			});
		}

		// then getting settings

		let rawSettings = await this._createOrGetSettings(msg.guild);

		// parse settings

		const settings = StreamNotifications._convertToNormalSettings(rawSettings);

		// caching for our dear interval

		this._guildSettingsCache[settings.guild] = settings;

		if (args[2] === "mention_everyone") {
			const index = settings.mentionsEveryone.findIndex((s) => {
				return !!subscription && s.serviceName === subscription.provider && s.uid === subscription.uid && s.username === subscription.username;
			});

			const newState = args[3] === "true";
			const currentState = index !== -1;

			if (newState === currentState) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						EmbedType.Error,
						msg.member, {
							key: LOCALIZED("_EDIT_FAULT_ME_ALREADY"),
							formatOptions: {
								status: currentState
							}
						}
					)
				});
			}

			if (newState) {
				// find current one?

				settings.mentionsEveryone.push({
					serviceName: subscription.provider,
					uid: subscription.uid,
					username: subscription.username
				});
			} else {
				settings.mentionsEveryone.splice(index, 1);
			}
		}

		rawSettings = StreamNotifications._convertToRawSettings(settings);

		await this._updateSettings(rawSettings);

		await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("EDIT_DONE"))
		});
	}

	/**
	 * [Subcommand Handler] Adds channel subscription
	 * @param msg Message
	 * @param args Arguments array
	 * @param scope Scope of calling. "user" if called to subscribe for user, or "user" if for guiild
	 */
	private async subcmd_add(msg: djs.Message, args: string[] | null, scope: "user" | "guild") {
		// !streams add YouTube, BlackSilverUfa
		// args at this point: ["YouTube", "BlackSilverUfa"]

		if (scope === "guild" && msg.channel.type !== "text") {
			return;
		}

		if (scope === "guild" && !rightsCheck(msg.member)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});

			return;
		}

		const i18nSubject = msg.channel.type === "dm" ? msg.author : msg.member;

		if (!args || (args.length !== 2 && args.length !== 3)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, i18nSubject, {
					key: LOCALIZED(scope === "guild" ? "ADD_USAGE" : "ADD_USAGE_DM"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});

			return;
		}

		const subscriber = scope === "guild" ? msg.guild : msg.author;

		const rawSettings = await this._createOrGetSettings(subscriber);
		const settings = rawSettings ? StreamNotifications._convertToNormalSettings(rawSettings) : undefined;

		if (!settings) {
			throw new Error("Unexpected behavior. No `settings` passed");
		}

		if (scope === "user" && (this.options.limits.users && settings.subscribedTo.length >= this.options.limits.users) && !isPremium(msg.author)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, {
					key: LOCALIZED("ADD_FAULT_NOPREMIUM"),
					formatOptions: {
						limit: this.options.limits.users
					}
				})
			});

			return;
		} else if ((this.whitelistModule && this.whitelistModule.base) && scope === "guild" && (this.options.limits.guilds && settings.subscribedTo.length >= this.options.limits.users)) {
			const whitelistStatus = await this.whitelistModule.base.isWhitelisted(msg.guild);
			if (!whitelistStatus) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: LOCALIZED("ADD_FAULT_NOPARTNER"),
						formatOptions: {
							limit: this.options.limits.guilds
						}
					})
				});

				return;
			}
		}

		const providerName = args[0].toLowerCase();
		const provider = this.servicesLoader.findBase<baseService.IStreamingService>(providerName, "name");

		if (!provider) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_PROVIDERNOTFOUND"))
			});

			return;
		}

		let streamer: baseService.IStreamingServiceStreamer | undefined = undefined;

		try {
			streamer = await provider.getStreamer(args[1]);
		} catch (err) {
			if (err instanceof baseService.StreamingServiceError) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED(err.stringKey))
				});
			} else {
				$snowball.captureException(err, { extra: messageToExtra(msg) });
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_UNKNOWN"))
				});
			}

			return;
		}

		if (!streamer) { return; }

		let alternativeChannel: Possible<djs.TextChannel> = undefined;
		{
			// checking alternative channel usage
			const usedAlternativeChannelArg = StreamNotifications._usedAlternativeChannelArgument(scope, msg.guild, args[2]);

			if (usedAlternativeChannelArg.use) {
				if (!usedAlternativeChannelArg.channel) {
					await msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, {
							key: LOCALIZED("ALT_CH_NOTFOUND@+ADDING"),
							formatOptions: {
								base: await i18n.localizeForUser(i18nSubject, LOCALIZED("ALT_CH_NOTFOUND"))
							}
						})
					});

					return;
				}

				if (this._determineSSSLimitReached(settings, {
					provider: providerName,
					uid: streamer.uid
				})) {
					if (isNaN(this.options.sss_limit)) { throw new Error("Unpredicted case happened"); }
					await msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, {
							key: LOCALIZED("ADD_FAULT_SSSREACHED"),
							formatOptions: {
								sssLimit: this.options.sss_limit
							}
						})
					});

					return;
				}

				alternativeChannel = usedAlternativeChannelArg.channel;
			}
		}

		let confirmationContent = "";

		confirmationContent += `${
			await i18n.localizeForUser(
				msg.member,
				LOCALIZED("ADD_CONFIRMATION"), {
					streamerName: streamer.username,
					streamerId: streamer.uid
				}
			)
		}\n\n`;

		confirmationContent += `${
			await i18n.localizeForUser(
				msg.member,
				LOCALIZED(
					scope === "guild" ?
						"ADD_CONFIRMATION_INFO_GUILD" :
						"ADD_CONFIRMATION_INFO_USER"
				)
			)
		}\n\n`;

		if (alternativeChannel) {
			confirmationContent += `${
				await i18n.localizeForUser(
					msg.member,
					LOCALIZED("ADD_CONFIRMATION_INFO_ALTCHANNEL"), {
						channel: alternativeChannel.toString()
					}
				)
			}\n\n`;
		}

		confirmationContent += `${
			await i18n.localizeForUser(
				msg.member,
				LOCALIZED("ADD_CONFIRMATION_INFO_SHARED")
			)
		}\n\n`;

		confirmationContent += `${
			await i18n.localizeForUser(
				msg.member,
				LOCALIZED("ADD_CONFIRMATION_QUESTION")
			)
		}`;

		const confirmationEmbed = await i18n.generateLocalizedEmbed(
			EmbedType.Question,
			i18nSubject, {
				custom: true,
				string:  confirmationContent
			}
		);

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("CANCELED"))
			});

			return;
		}

		const subscription = await this._addStreamerSubscriber(streamer, alternativeChannel ? StreamNotifications._getGuildAlternativeID(msg.guild.id, alternativeChannel.id) : subscriber);
	
		await this._recordSubscription(subscriber, subscription, alternativeChannel ? alternativeChannel.id : undefined, settings);

		await this._noFetchingAvoidance(subscription);

		await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.OK, i18nSubject, {
				key: LOCALIZED("ADD_DONE"),
				formatOptions: {
					streamerName: subscription.username,
					streamerId: subscription.uid
				}
			})
		});
	}

	private async subcmd_remove(msg: djs.Message, args: string[] | null, scope: "guild" | "user") {
		// !streams remove YouTube, ID
		// args at this point: ["YouTube", "ID"]

		if (scope === "guild" && msg.channel.type !== "text") {
			return;
		}

		if (scope === "guild" && !rightsCheck(msg.member)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});

			return;
		}

		const i18nSubject = msg.channel.type === "dm" ? msg.author : msg.member;

		if (!args || (args.length !== 2 && args.length !== 3)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, i18nSubject, {
					key: LOCALIZED("REMOVE_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});

			return;
		}

		const providerName = args[0].toLowerCase();
		const streamerUID = args[1];
		let alternativeChannel: djs.TextChannel | undefined = undefined;

		{
			// checking alternative channel usage
			const usedAlternativeChannelArg = StreamNotifications._usedAlternativeChannelArgument(scope, msg.guild, args[2]);
			if (usedAlternativeChannelArg.use) {
				if (!usedAlternativeChannelArg.channel) {
					await msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(EmbedType.Error, i18nSubject, {
							key: LOCALIZED("ALT_CH_NOTFOUND@+REMOVAL"),
							formatOptions: {
								base: await i18n.localizeForUser(i18nSubject, LOCALIZED("ALT_CH_NOTFOUND"))
							}
						})
					});

					return;
				}
				alternativeChannel = usedAlternativeChannelArg.channel;
			}
		}

		let rawSubscription = await this._findSubscription({
			provider: providerName,
			uid: streamerUID
		});

		const subscriber = scope === "guild" ? msg.guild : msg.author;

		await (async () => {
			if (!rawSubscription) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("REMOVE_FAULT_SUBNOTFOUND"))
				});

				return;
			}

			const confirmationEmbed = await i18n.generateLocalizedEmbed(EmbedType.Question, i18nSubject, {
				key: LOCALIZED("REMOVE_CONFIRMATION"),
				formatOptions: {
					streamerId: rawSubscription.uid,
					streamerUsername: rawSubscription.username
				}
			});

			const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

			if (!confirmation) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("REMOVE_CANCELED"))
				});

				return;
			}

			rawSubscription = await this._findSubscription({
				provider: providerName,
				uid: streamerUID
			});

			if (!rawSubscription) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("REMOVE_FAULT_SUBNOTFOUND_REFETCH"))
				});

				return;
			}

			let normalSubscription = this._convertToNormalSubscription(rawSubscription);

			normalSubscription = await this._removeSubscriber(normalSubscription, alternativeChannel ? StreamNotifications._getGuildAlternativeID(msg.guild.id, alternativeChannel.id) : subscriber);

			await this._uselessFetchingAvoidance(normalSubscription);

			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.OK, i18nSubject, LOCALIZED("REMOVE_DONE"))
			});
		})();

		await this._retirePseudoSubscription(subscriber, {
			serviceName: providerName,
			uid: streamerUID,
			alternativeChannel: alternativeChannel ? alternativeChannel.id : undefined
		});
	}

	private static _usedAlternativeChannelArgument(scope: "guild" | "user", guild: djs.Guild, arg?: string) : {
		use: boolean; channel?: djs.TextChannel;
	} {
		if (scope !== "guild" || !arg) { return { use: false }; }

		return {
			use: true,
			channel: <djs.TextChannel> utils.resolveGuildChannel(arg, guild, {
				caseStrict: false,
				strict: false,
				possibleMention: true,
				types: ["text"]
			})
		};
	}

	private async subcmd_list(msg: djs.Message, calledAs: string | null, args: string[] | null) {
		// !streams 2
		// !streams YouTube 2

		if (msg.channel.type === "text" && !rightsCheck(msg.member)) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});

			return;
		}

		const subject = msg.channel.type === "dm" ? msg.author : msg.member;

		if (!calledAs) {
			calledAs = "1";
			args = null;
		}

		let page = 1;
		let provider = "any";

		if (args && args.length > 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("LIST_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
		} else if (args) {
			page = parseInt(args[0], 10);
			provider = calledAs.toLowerCase();
			if (isNaN(page) || page < 1) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_INVALIDPAGE"))
				});
			}
		} else if (!args) {
			if (/^[0-9]+$/.test(calledAs)) {
				page = parseInt(calledAs, 10);
			} else {
				page = 1;
				provider = calledAs.toLowerCase();
			}
		}

		const offset = (SUBS_PER_PAGE * (page - 1));
		const end = offset + SUBS_PER_PAGE;

		const rawSettings = await this._getSettings(msg.channel.type === "text" ? msg.guild : msg.author);

		if (!rawSettings) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_ISEMPTY"))
			});
		}

		const normalSettings = StreamNotifications._convertToNormalSettings(rawSettings);

		let subscriptions = normalSettings.subscribedTo;

		if (provider !== "any") {
			subscriptions = subscriptions.filter(r => {
				return r.serviceName === provider;
			});
		}

		subscriptions = subscriptions.slice(offset, end);

		if (subscriptions.length === 0) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_ISEMPTY"))
			});
		}

		const fields: IEmbedOptionsField[] = [];

		let c = 0;

		for (const result of subscriptions) {
			fields.push({
				inline: false,
				name: `${++c}. ${result.username}`,
				value: await i18n.localizeForUser(msg.member, "STREAMING_LIST_ITEM", {
					provider: result.serviceName,
					id: result.uid
				})
			});
		}

		await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.Information, subject, {
				key: LOCALIZED("LIST_DESCRIPTION"),
				formatOptions: {
					count: subscriptions.length,
					page
				}
			}, { fields })
		});
	}

	// #endregion

	// =======================================
	// Easy functions
	// =======================================

	private async _addSubscriber(subscription: ISubscriptionRow, target: UserTarget) {
		target = StreamNotifications._normalizeTarget(target);
		if (subscription.subscribers.includes(target)) {
			throw new Error(`Target "${target}" is already subscribed to ${subscription.provider}[${subscription.uid}]`);
		}

		subscription.subscribers.push(target);

		await this._updateSubscription(this._convertToRawSubscription(subscription));

		return subscription;
	}

	private async _removeSubscriber(subscription: ISubscriptionRow, target: UserTarget) {
		target = StreamNotifications._normalizeTarget(target);

		const index = subscription.subscribers.indexOf(target);
		if (index === -1) {
			throw new Error(`Target "${target}" is not found as a subscriber of ${subscription.provider}[${subscription.uid}]`);
		}

		subscription.subscribers.splice(index, 1);

		await this._updateSubscription(this._convertToRawSubscription(subscription));

		return subscription;
	}

	private async _addStreamerSubscriber(streamer: baseService.IStreamingServiceStreamer, target: UserTarget) {
		let subscription = await this._findSubscription({
			provider: streamer.serviceName,
			uid: streamer.uid
		});

		if (!subscription) {
			subscription = await this._createSubscription({
				provider: streamer.serviceName,
				uid: streamer.uid,
				username: streamer.username,
				subscribers: "[]"
			});
		}

		return this._addSubscriber(this._convertToNormalSubscription(subscription), target);
	}

	// private async _removeStreamerSubscriber(streamer: IStreamingServiceStreamer, target: string | Guild | User) {
	// 	const subscription = await this._findSubscription({
	// 		provider: streamer.serviceName,
	// 		uid: streamer.uid
	// 	});

	// 	if (!subscription) { return undefined; }

	// 	return this._removeSubscriber(this._convertToNormalSubscription(subscription), target);
	// }

	private async _recordSubscription(target: GuildTarget, subscription: ISubscriptionRow, altChannel?: string, settings?: ISettingsParsedRow) {
		target = StreamNotifications._normalizeTarget(target);

		if (!settings) {
			settings = StreamNotifications._convertToNormalSettings(await this._createOrGetSettings(target));
		}

		if (!subscription.subscribers.includes(target)) {
			return settings; // doing nothin'!
		}

		const activeSubscription = settings.subscribedTo.find(s => s.serviceName === subscription.provider && s.uid === subscription.uid && s.alternativeChannel === altChannel);

		if (!activeSubscription) {
			settings.subscribedTo.push({
				serviceName: subscription.provider,
				uid: subscription.uid,
				username: subscription.username,
				alternativeChannel: altChannel || undefined // just in case
			});

			await this._updateSettings(StreamNotifications._convertToRawSettings(settings));
		}

		return settings;
	}

	private async _retireSubscription(target: GuildTarget, subscription: ISubscriptionRow, altChannel?: string, settings?: ISettingsParsedRow) {
		target = StreamNotifications._normalizeTarget(target);

		if (subscription.subscribers && subscription.subscribers.includes(target)) {
			return settings;
		}

		return this._retirePseudoSubscription(target, this._convertToPseudoSettingsSub(subscription, altChannel), settings);
	}

	private async _retirePseudoSubscription(target: GuildTarget, pseudoSubsciption: IPseudoSettingsSubscription, settings?: ISettingsParsedRow) {
		target = StreamNotifications._normalizeTarget(target);

		if (!settings) {
			settings = StreamNotifications._convertToNormalSettings(await this._createOrGetSettings(target));
		}

		const activeSubscriptionIndex = settings.subscribedTo.findIndex(s => s.serviceName === pseudoSubsciption.serviceName && s.uid === pseudoSubsciption.uid && s.alternativeChannel === pseudoSubsciption.alternativeChannel);

		if (activeSubscriptionIndex !== -1) {
			settings.subscribedTo.splice(activeSubscriptionIndex, 1);
			await this._updateSettings(StreamNotifications._convertToRawSettings(settings));
		}

		return settings;
	}

	private async _noFetchingAvoidance(subscription: ISubscriptionRow) {
		if (subscription.subscribers.length === 0) {
			this.log("warn_trace", `[No Fetching Avoidance] Asked to check "${subscription.provider}[${subscription.uid}]", but no subscriptions found. Consider calling 'uselessFetchingAvoidance' instead. No action taken, returning \`false\` result`);

			return false;
		}

		const provider = this.servicesLoader.findBase<baseService.IStreamingService>(subscription.provider, "name");

		if (!provider) {
			this.log("warn", `[No Fetching Avoidance] Asked to check "${subscription.provider}[${subscription.uid}]", but there is no such provider. No action taken, returning \`false\` result`);

			return false;
		}

		if ($botConfig.mainShard) {
			if (provider.isSubscribed(subscription.uid)) {
				this.log("warn", `[No Fetching Avoidance] Already subscribed to "${subscription.provider}[${subscription.uid}]". No action taken, returning \`false\` result`);

				return false;
			}

			provider.addSubscription(this._convertToStreamer(subscription));
		} else if (process.send) {
			this.log("info", `[No Fetching Avoidance] Sending message to other shards to set up fetching of "${subscription.provider}[${subscription.uid}]"`);

			process.send({
				type: SHARDING_MESSAGE_TYPES.UNSUBSCRIBE,
				payload: {
					provider: subscription.provider,
					uid: subscription.uid
				}
			});
		} else {
			const eText = `Not in the main shard, but \`process.send\` is not provided. Deadlock reached.`;
			this.log("err_trace", `[No Fetching Avoidance] ${eText}`);

			throw new Error(eText);
		}

		return true;
	}

	private async _uselessFetchingAvoidance(subscription: IPseudoSubscription & { subscribers?: string[]; } | ISubscriptionRow) {
		if (subscription.subscribers && subscription.subscribers.length > 0) { return false; }

		// delete subscription
		await this._deleteSubscription(subscription);

		const provider = this.servicesLoader.findBase<baseService.IStreamingService>(subscription.provider, "name");

		if (!provider) {
			this.log("warn", `[Useless Fetching Avoidance] Asked to check "${subscription.provider}[${subscription.uid}]", but there is no such provider. No action taken, returning \`false\` result`);

			return false;
		}

		if ($botConfig.mainShard) {
			this.log("ok", `[Useless Fetching Avoidance] Stopping fetching of "${subscription.provider}[${subscription.uid}]"`);
			if (!provider.isSubscribed(subscription.uid)) { return true; }
			provider.removeSubscription(subscription.uid);
		} else if (process.send) {
			this.log("info", `[Useless Fetching Avoidance] Sending message to other shards asking to remove fetching of "${subscription.provider}[${subscription.uid}]"`);
			process.send({
				type: SHARDING_MESSAGE_TYPES.UNSUBSCRIBE,
				payload: {
					provider: subscription.provider,
					uid: subscription.uid
				}
			});
		} else {
			const eText = `Not in the main shard, but \`process.send\` is not provided. Deadlock reached.`;
			this.log("err_trace", `[Useless Fetching Avoidance] ${eText}`);
			throw new Error(eText);
		}

		return true;
	}

	private _determineSSSLimitReached(settings: ISettingsParsedRow, pseudoSubsciption: IPseudoSubscription) {
		let simultaneousSubscriptions = 0;
		for (const subscription of settings.subscribedTo) {
			if (subscription.serviceName !== pseudoSubsciption.provider) { continue; }
			if (subscription.uid !== pseudoSubsciption.uid) { continue; }
			if (++simultaneousSubscriptions >= this.options.sss_limit) { return true; }
		}

		return false;
	}

	private async _unsubscribe(subscription: ISubscriptionRow, subscriber: {
		guildId: string;
		channelId?: string;
	}) {
		await this._removeSubscriber(subscription, subscriber.channelId ? StreamNotifications._getGuildAlternativeID(subscriber.guildId, subscriber.channelId) : subscriber.guildId);
		await this._retireSubscription(subscriber.guildId, subscription, subscriber.channelId);
		await this._uselessFetchingAvoidance(subscription);
	}

	// #region User ID

	private static _getUserSubscriberID(user: djs.User) {
		return `u${user.id}`;
	}

	// private static _isUserSubscriberID(id: string) {
	// 	return USER_SUBSCRIBER_REGEXP.test(id);
	// }

	private static _recoverUserID(id: string) {
		const res = USER_SUBSCRIBER_REGEXP.exec(id);
		if (!res || !res[1]) { return undefined; }

		return res[1];
	}

	private static _getGuildAlternativeID(guildId: string, channelId: string) {
		return `${guildId}:${channelId}`;
	}

	private static _recoverGuildID(id: string) {
		const res = GUILD_SUBSCRIBER_REGEXP.exec(id);
		if (!res || res.length !== 3) { return undefined; }

		return {
			guildId: res[1],
			channelId: res[2] === "" ? undefined : res[2].slice(1)
		};
	}

	// #endregion

	// private _isSubbed(subscription: ISubscriptionRow, target: Guild | User) {
	// 	const normalizedTarget = StreamNotifications._normalizeTarget(target);
	// 	return subscription.subscribers.includes(normalizedTarget);
	// }

	private static _normalizeTarget(target: UserTarget) {
		if (typeof target !== "string") {
			if (target instanceof djs.Guild) {
				target = target.id;
			} else if (target instanceof djs.User) {
				target = StreamNotifications._getUserSubscriberID(target);
			}
		}

		return target;
	}

	// =======================================
	// Notifications centre
	// =======================================

	// #region Notifications cleanup

	// private _cleanupPromise: undefined | Promise<void> = undefined;

	private _cleanupInterval: NodeJS.Timer;

	private async _doNotificationsCleanup() {
		const notifications = await this._getAllNotifications();
		// let resolveFunction: undefined | (() => void) = undefined;
		// this._cleanupPromise = new Promise((r) => {
		// 	resolveFunction = r;
		// });
		await sleep(100);

		for (const notification of notifications) {
			if ((Date.now() - notification.sentAt) > MAX_NOTIFIED_LIFE) {
				await this._deleteNotification(notification);
			}
		}

		// if (resolveFunction) {
		// 	resolveFunction!(); // why the hell it's NEVER???
		// 	// this._cleanupPromise = undefined;
		// }
	}

	// #endregion

	// #region Handling notifications

	private readonly _guildSettingsCache: INullableHashMap<ISettingsParsedRow> = Object.create(null);

	private readonly _handlers: {
		online: INullableHashMap<baseService.StreamStatusChangedHandler[]>,
		updated: INullableHashMap<baseService.StreamStatusChangedHandler[]>,
		offline: INullableHashMap<baseService.StreamStatusChangedHandler[]>
	} = { online: Object.create(null), updated: Object.create(null), offline: Object.create(null) };

	private async _doHandleNotifications() {
		for (const providerName in this.servicesLoader.loadedModulesRegistry) {
			this.log("info", `Trying to handle notifications of module '${providerName}'`);
			const mod = <ModuleBase<baseService.IStreamingService> | undefined> this.servicesLoader.loadedModulesRegistry[providerName];

			if (!mod || !mod.base) {
				this.log("err", `${providerName} is still not loaded (?!)`);
				continue;
			}

			const provider = <baseService.IStreamingService> mod.base;

			for (const action of <baseService.StreamStatusChangedAction[]> ["online", "updated", "offline"]) {
				const handler = (status: baseService.IStreamStatus) => {
					try {
						this._doHandleNotification(providerName, status);
					} catch (err) {
						this.log("err", "Failed to handle notification", err);
						$snowball.captureException(err, { extra: { providerName, status } });
					}
				};
				provider.on(action, handler);
				let handlersCollection = this._handlers[action][providerName];
				if (!handlersCollection) {
					handlersCollection = this._handlers[action][providerName] = [];
				}
				handlersCollection.push(handler);
			}

			// loading subscriptions unto provider

			const subscriptions = await this._findSubscriptionsByFilter({
				provider: providerName
			});

			for (const subscription of subscriptions) {
				if (provider.isSubscribed(subscription.uid)) {
					continue;
				}

				provider.addSubscription({
					serviceName: providerName,
					uid: subscription.uid,
					username: subscription.username
				});
			}

			if (provider.start) {
				await provider.start();
			}

			this.log("ok", `Handling notifications for provider '${providerName}' complete`);
		}
	}

	private async _doHandleNotification(providerName: string, status: baseService.IStreamStatus) {
		if (!$botConfig.mainShard) {
			throw new Error("This could be called only in main shard!");
		}

		const subscriptions = (await this._findSubscriptionsByFilter({
			provider: providerName,
			uid: status.streamer.uid
		})).map(this._convertToNormalSubscription);

		for (const subscription of subscriptions) {
			if (subscription.username !== status.streamer.username) {
				// for cases if streamer changed username (Twitch/Mixer)
				subscription.username = status.streamer.username;
			}

			for (const subscriberId of subscription.subscribers) {
				const notification = await this._findNotification(subscription.provider, subscription.uid, (status.updated && status.oldId ? status.oldId : status.id), subscriberId);

				const userId = StreamNotifications._recoverUserID(subscriberId);

				if (userId) {
					// user subscriber
					const user = await $discordBot.users.fetch(userId);

					if (!user) {
						this.log("warn", `Could not find subscribed user "${userId}"`);
						continue;
					}

					await this._pushNotification(user, status, subscription, notification);
				} else {
					const gachIds = StreamNotifications._recoverGuildID(subscriberId); // ( ͡° ͜ʖ ͡°)
					if (!gachIds) {
						this.log("warn", `Invalid ID "${subscriberId}" passed for guild, could not parse it`);
						continue; // not removing atm, just for safety
					}

					const guild = $discordBot.guilds.get(gachIds.guildId);

					if (guild) {
						const alternativeChannel: djs.GuildChannel | undefined = gachIds.channelId ? guild.channels.get(gachIds.channelId) : undefined;
						if (alternativeChannel && alternativeChannel.type !== "text") {
							this.log("warn", `Invalid channel passed. Found that channel by ID "${gachIds.channelId}" is "${alternativeChannel.type}"`);
							await this._unsubscribe(subscription, gachIds);
							continue;
						} else if (gachIds.channelId != null && !alternativeChannel) {
							this.log("warn", `Alternative channel by ID "${gachIds.channelId}" not found`);
							await this._unsubscribe(subscription, gachIds);
						}
						await this._pushNotification(guild, status, subscription, notification, <djs.TextChannel> alternativeChannel);
					} else if (!guild && process.send) {
						process.send({
							type: SHARDING_MESSAGE_TYPES.PUSH,
							payload: {
								ifYouHaveGuild: subscriberId,
								notifyAbout: {
									subscription,
									notification,
									status,
									alternativeChannel: gachIds.channelId
								}
							}
						});
					} else {
						this.log("warn", `Could not find subscribed guild and notify other shards: ${subscriberId} to ${subscription.provider}[${subscription.uid}]`);
						await this._unsubscribe(subscription, gachIds);
					}
				}
			}
		}
	}

	private async _pushNotification(scope: djs.Guild | djs.User, result: baseService.IStreamStatus, subscription: ISubscriptionRow, notification?: INotification, alternativeChannel?: djs.TextChannel) {
		const providerName = subscription.provider;
		const provider = this.servicesLoader.findBase<baseService.IStreamingService>(providerName, "name");

		if (!provider) {
			this.log("warn", `[Push] "${providerName}" not found as loaded service`);

			return;
		}

		if ((!result.updated && result.status !== "offline") && notification) {
			return;
		}

		const embedLanguage = scope instanceof djs.User ? await i18n.getUserLanguage(scope) : await i18n.getGuildLanguage(scope);

		let embed: IEmbed | undefined = undefined;

		try {
			embed = await provider.getEmbed(result, embedLanguage);
		} catch (err) {
			$snowball.captureException(err, {
				extra: {
					embedLanguage,
					result, providerName
				}
			});

			this.log("err", `[Push] Failed to get embed for stream of "${subscription.provider}[${subscription.uid}]"`, err);

			return;
		}

		if (!embed) {
			this.log("warn", `[Push] Embed has not returned for stream of "${subscription.provider}[${subscription.uid}]"`);

			return;
		}

		let settings = this._guildSettingsCache[scope.id];
		if (!settings) {
			const dbSettings = await this._getSettings(scope);
			if (!dbSettings) {
				this.log("err", `Not found \`dbSettings\` for subscriber "${scope.id}" of subscription "${providerName}[${subscription.uid}]"`);

				return;
			}

			settings = StreamNotifications._convertToNormalSettings(dbSettings);
			this._guildSettingsCache[scope.id] = settings;
		}

		const isUser = scope instanceof djs.User;

		let channel: djs.TextChannel | djs.DMChannel | undefined = alternativeChannel;

		if (isUser) {
			const user = <djs.User> scope;
			channel = user.dmChannel;
			if (!channel) {
				channel = await user.createDM();
			}
		}

		if (!isUser && !channel) {
			if (!settings.channelId || settings.channelId === "-") { return; }

			const guild = <djs.Guild> scope;
			channel = <djs.TextChannel> guild.channels.get(settings.channelId);
		}

		if (!channel) {
			this.log("err", `Not found channel for subscribed subject ${scope.id} to subscription ${subscription.uid} (${providerName}) (subject-type: ${isUser ? "user" : "guild"})`);

			// TODO: Test if guild is currently offline

			await this._unsubscribe(
				subscription,
				scope instanceof djs.User ? {
					guildId: StreamNotifications._getUserSubscriberID(scope)
				} : {
					guildId: scope.id,
					channelId: alternativeChannel ? alternativeChannel.id : undefined
				}
			);

			return;
		}

		const shouldMentionEveryone = !!settings.mentionsEveryone.find(s => {
			return s.serviceName === providerName && (s.uid === subscription.uid || s.username === subscription.username) && (alternativeChannel ? s.alternativeChannel === alternativeChannel.id : true);
		});

		if ((result.updated || result.status === "offline") && (notification && notification.channelId === channel.id)) {
			const msg = await (async () => {
				try {
					return (await channel.messages.fetch(notification.messageId));
				} catch (err) {
					this.log("err", "Could not find message with ID", notification.messageId, "to update message", err);

					if (err instanceof djs.DiscordAPIError) {
						await this._deleteNotification(notification);
					}

					return undefined;
				}
			})();

			if (!msg) { return; }

			try {
				const escapedUsername = utils.escapeDiscordMarkdown(subscription.username, true);
				await msg.edit(shouldMentionEveryone && !result.noEveryone ?
					(result.status === "offline" ? "~~@everyone~~ " : "@everyone ") + $localizer.getFormattedString(embedLanguage, result.status === "offline" ? LOCALIZED("NOTIFICATION_EVERYONE_OFFLINE") : LOCALIZED("NOTIFICATION_EVERYONE_UPDATED"), {
						username: escapedUsername
					}) : (
						isUser ? $localizer.getFormattedString(
							embedLanguage,
							result.status === "offline" ? LOCALIZED("NOTIFICATION_DM_OFFLINE") : LOCALIZED("NOTIFICATION_DM_UPDATED"), {
								username: escapedUsername,
								notice: $localizer.getFormattedString(embedLanguage, LOCALIZED(result.status === "offline" ? "NOTIFICATION_DM_NOTICE_OFFLINE" : "NOTIFICATION_DM_NOTICE"), {
									username: escapedUsername
								}),
								command: `${PREFIX} unsubscribe ${providerName}, ${subscription.uid}`
							}) : ""
					), {
						embed: <any> embed
					});
			} catch (err) {
				this.log("err", "Failed to update message with ID", notification.messageId, err);
				$snowball.captureException(err, {
					extra: { subscription, embedLanguage, result, channel: channel }
				});
			}

			if (result.status === "offline") {
				await this._deleteNotification(notification);
				// we don't need it anymore
			} else {
				notification.streamId = result.id;
				notification.sentAt = Date.now();
				await this._updateNotification(notification);
			}
		} else if (result.status !== "offline") {
			let messageId = "";
			const escapedUsername = utils.escapeDiscordMarkdown(subscription.username, true);
			try {
				const msg = <djs.Message> await channel.send(shouldMentionEveryone ?
					`@everyone ${$localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_EVERYONE"), {
						username: escapedUsername
					})}` : (
						isUser ? $localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_DM_STARTED"), {
							username: escapedUsername,
							notice: $localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_DM_NOTICE"), {
								username: escapedUsername
							}),
							command: `${PREFIX} unsubscribe ${providerName}, ${subscription.uid}`
						}) : ""
					), {
						embed: <any> embed
					});
				messageId = msg.id;
			} catch (err) {
				$snowball.captureException(err, {
					extra: { subscription, embedLanguage, result, channelId: channel.id }
				});

				const subId = `${subscription.provider}[${subscription.uid}]`;

				this.log("err", `Failed to send notification for stream of "${subId}" to channel "${channel.id}". Error occured`, err);

				if (err instanceof djs.DiscordAPIError) {
					if (err.code === 50007) {
						// can't send messages to this user 👍
						this.log("info", `Unsubscribing "${channel.id}" from "${subId}": user blocked us`);
						await this._unsubscribe(subscription, isUser ? {
							guildId: StreamNotifications._getUserSubscriberID(<djs.User> scope)
						} : {
							guildId: scope.id,
							channelId: alternativeChannel ? alternativeChannel.id : undefined
						});
					}

					return;
				}
			}

			notification = {
				guild: alternativeChannel ? StreamNotifications._getGuildAlternativeID(scope.id, alternativeChannel.id) : StreamNotifications._normalizeTarget(scope),
				channelId: channel.id,
				messageId,
				provider: subscription.provider,
				sentAt: Date.now(),
				streamerId: subscription.uid,
				streamId: result.id
			};

			await this._saveNotification(notification);
		}
	}

	// #endregion

	// =======================================
	// Additional bridge functions
	// =======================================

	// #region Getter functions with the fallbacks

	private async _createOrGetSettings(scope: djs.Guild | djs.User | string) {
		let settings = await this._getSettings(scope);
		if (!settings) {
			settings = await this._createSettings({
				channelId: null,
				guild: typeof scope === "string" ? scope : (scope instanceof djs.User ? `u${scope.id}` : scope.id),
				mentionsEveryone: "[]",
				subscribedTo: "[]"
			});
		}

		return settings;
	}

	// #endregion

	// =======================================
	// Converting
	// =======================================

	// #region Convert functions

	private static _convertToNormalSettings(raw: ISettingsRow): ISettingsParsedRow {
		return {
			channelId: raw.channelId,
			guild: raw.guild,
			mentionsEveryone: JSON.parse(raw.mentionsEveryone),
			subscribedTo: JSON.parse(raw.subscribedTo)
		};
	}

	private static _convertToRawSettings(normal: ISettingsParsedRow): ISettingsRow {
		return {
			channelId: normal.channelId,
			guild: normal.guild,
			mentionsEveryone: JSON.stringify(normal.mentionsEveryone),
			subscribedTo: JSON.stringify(normal.subscribedTo)
		};
	}

	// private static _convertToMap<T>(toConvert: T[], key: string): Map<string, T> {
	// 	const map = new Map<string, T>();
	// 	for (const elem of toConvert) {
	// 		map.set(elem[key], elem);
	// 	}
	// 	return map;
	// }

	private _convertToNormalSubscription(raw: ISubscriptionRawRow): ISubscriptionRow {
		return {
			username: raw.username,
			uid: raw.uid,
			provider: raw.provider,
			subscribers: JSON.parse(raw.subscribers)
		};
	}

	private _convertToRawSubscription(normal: ISubscriptionRow): ISubscriptionRawRow {
		return {
			username: normal.username,
			uid: normal.uid,
			provider: normal.provider,
			subscribers: JSON.stringify(normal.subscribers)
		};
	}

	private _convertToStreamer(subscription: ISubscriptionRow | ISubscriptionRawRow): baseService.IStreamingServiceStreamer {
		return {
			serviceName: subscription.provider,
			uid: subscription.uid,
			username: subscription.username
		};
	}

	private _convertToPseudoSettingsSub(subscription: ISubscriptionRow | ISubscriptionRawRow, altChannel?: string) : IPseudoSettingsSubscription {
		return {
			serviceName: subscription.provider,
			uid: subscription.uid,
			alternativeChannel: altChannel
		};
	}

	// #endregion

	// =======================================
	// DB<>Plugin methods
	// =======================================

	// #region Working with DB

	private async _getAllNotifications() : Promise<INotification[]> {
		return this.db(TABLE.notifications).select();
	}

	private async _findSubscriptionsByFilter(filter: SubscriptionFilter): Promise<ISubscriptionRawRow[]> {
		return this.db(TABLE.subscriptions).select().where(filter);
	}

	private async _findSubscription(filter: SubscriptionFilter): Promise<ISubscriptionRawRow | undefined> {
		if (!filter.uid && !filter.username) {
			throw new Error("Nor uid nor username provided");
		}

		return this.db(TABLE.subscriptions).select().where(filter).first();
	}

	private async _createSubscription(row: ISubscriptionRawRow) {
		await this.db(TABLE.subscriptions).insert(row);

		return row;
	}

	private async _updateSubscription(newSubscription: ISubscriptionRawRow) {
		return this.db(TABLE.subscriptions).where({
			provider: newSubscription.provider,
			uid: newSubscription.uid,
			username: newSubscription.username
		}).update(newSubscription);
	}

	private async _deleteSubscription(pseudoSubscription: IPseudoSubscription) {
		return this.db(TABLE.subscriptions).where({
			provider: pseudoSubscription.provider,
			uid: pseudoSubscription.uid
		}).delete();
	}

	private async _getSettings(scope: djs.Guild | djs.User | string): Promise<ISettingsRow | undefined> {
		return this.db(TABLE.settings).where({
			guild: typeof scope === "string" ? scope : (scope instanceof djs.User ? `u${scope.id}` : scope.id)
		}).first();
	}

	private async _createSettings(row: ISettingsRow) {
		await this.db(TABLE.settings).insert(row);

		return row;
	}

	private async _updateSettings(newSettings: ISettingsRow) {
		return this.db(TABLE.settings).where({
			guild: newSettings.guild
		}).update(newSettings);
	}

	private async _saveNotification(notification: INotification) {
		return this.db(TABLE.notifications).insert(notification);
	}

	private async _updateNotification(notification: INotification) {
		return this.db(TABLE.notifications).where(<INotification> {
			guild: notification.guild,
			provider: notification.provider,
			streamerId: notification.streamerId
		}).update(notification);
	}

	private async _deleteNotification(notification: INotification) {
		return this.db(TABLE.notifications).where(notification).delete();
	}

	private async _findNotification(provider: string, streamerId: string, streamId: string, guild: djs.Guild | string): Promise<INotification | undefined> {
		return this.db(TABLE.notifications).where(<INotification> {
			provider,
			streamerId,
			streamId,
			guild: guild instanceof djs.Guild ? guild.id : guild
		}).first();
	}

	// #endregion

	// =======================================
	// Plugin init & unload
	// =======================================

	// #region Plugin initialization and unloading functions

	private shardingHandler: (msg: any) => void | undefined;

	public async init() {
		// #region Subscribers table preparation

		const subscriptionsTableCreated = await this.db.schema.hasTable(TABLE.subscriptions);
		if (!subscriptionsTableCreated) {
			this.log("info", "Table of subscriptions not found, going to create it right now");
			await db.createTableBySchema(TABLE.subscriptions, {
				provider: "string",
				uid: "string",
				username: "string",
				subscribers: {
					type: "MEDIUMTEXT"
				}
			});
		}

		// #endregion

		// #region Settings table preparation

		const settingsTableCreated = await this.db.schema.hasTable(TABLE.settings);
		if (!settingsTableCreated) {
			this.log("info", "Table of settings not found, going to create it right now");
			await db.createTableBySchema(TABLE.settings, {
				guild: {
					type: "string",
					comment: "Guild ID that these settings used for"
				},
				channelId: {
					type: "string",
					comment: "Channel ID where notifications going to"
				},
				mentionsEveryone: {
					type: "TEXT",
					comment: "A list of channels with turned on everyone mention"
				},
				subscribedTo: {
					type: "TEXT",
					comment: "A list of subscriptions"
				}
			});
		}

		// #endregion

		// #region Creating notifications table

		const notificationsTableCreated = await this.db.schema.hasTable(TABLE.notifications);
		if (!notificationsTableCreated) {
			this.log("info", "Table of notifications statuses not found, will be created in momento");
			await db.createTableBySchema(TABLE.notifications, {
				guild: {
					type: "string",
					comment: "ID of the guild that was notified"
				},
				provider: {
					type: "string",
					comment: "Provider stream comes from"
				},
				channelId: {
					type: "string",
					comment: "ID of channel that was notified"
				},
				streamId: {
					type: "string",
					comment: "ID of the stream"
				},
				streamerId: {
					type: "string",
					comment: "UID of channel on streaming service"
				},
				messageId: {
					type: "string",
					comment: "ID of message with notification"
				},
				sentAt: {
					type: "bignumber",
					comment: "Timestamp when guild was notified"
				}
			});
		}

		// #endregion

		// #region Notifications providers loading

		for (const serviceName in this.servicesList) {
			await this.servicesLoader.load(serviceName);
		}

		// #endregion

		// #region Whitelist module checkup

		const whitelistModule = $modLoader.findKeeper<Whitelist>("snowball.core_features.whitelist");
		if (!whitelistModule) {
			this.log("warn", "Could not find whitelist module.");
		} else {
			this.whitelistModule = whitelistModule;
		}

		// #endregion

		// #region Sharding messages handling

		if ($botConfig.mainShard) {
			this._cleanupInterval = setInterval(() => this._doNotificationsCleanup(), 86400000);
			await this._doNotificationsCleanup();
			await this._doHandleNotifications();
		}

		if ($botConfig.sharded) {
			const handler = $botConfig.mainShard ? (msg: any) => {
				if (typeof msg !== "object") { return; }
				if (!msg.type || !msg.payload) { return; }
				if (msg.type !== SHARDING_MESSAGE_TYPES.SUBSCRIBE && msg.type !== SHARDING_MESSAGE_TYPES.UNSUBSCRIBE) { return; }

				this.log("info", "[ShardedMessageHandler] Received message", msg);

				if (msg.type === SHARDING_MESSAGE_TYPES.UNSUBSCRIBE) {
					this._uselessFetchingAvoidance(msg.payload);
				} else if (msg.type === SHARDING_MESSAGE_TYPES.SUBSCRIBE) {
					this._noFetchingAvoidance(msg.payload);
				}
			} : (msg: any) => {
				if (typeof msg !== "object") { return; }
				if (!msg.type || !msg.payload) { return; }
				if (msg.type !== SHARDING_MESSAGE_TYPES.PUSH) { return; }

				this.log("info", "[ShardedMessageHandler] Received message", msg);
				// tslint:disable-next-line:early-exit
				if (msg.payload.ifYouHaveGuild && msg.payload.notifyAbout) {
					const guild = $discordBot.guilds.get(<string> msg.payload.ifYouHaveGuild);
					if (guild) {
						// process
						const notifyAbout = <{
							subscription: ISubscriptionRow,
							notification: INotification,
							result: baseService.IStreamStatus
						}> msg.payload.notifyAbout;
						this._pushNotification(guild, notifyAbout.result, notifyAbout.subscription, notifyAbout.notification);
					}
				}
			};

			this.shardingHandler = handler;

			process.on("message", handler);
		}

		// #endregion

		this.handleEvents();
	}

	public async unload() {
		if (this._cleanupInterval) { clearInterval(this._cleanupInterval); }

		if (this.shardingHandler) { process.removeListener("message", this.shardingHandler); }

		await this.servicesLoader.unload(Object.getOwnPropertyNames(this.servicesLoader.loadedModulesRegistry));

		this.unhandleEvents();

		return true;
	}

	// #endregion
}

interface ISubscriptionRawRow {
	provider: string;
	uid: string;
	username: string;
	subscribers: string;
}

interface ISettingsRow {
	guild: string;
	channelId: string | "-" | null;
	mentionsEveryone: string;
	subscribedTo: string;
}

interface ISettingsParsedRow {
	channelId: string | null;
	guild: string;
	mentionsEveryone: ISettingsSubscription[];
	subscribedTo: ISettingsSubscription[];
}

interface ISettingsSubscription extends baseService.IStreamingServiceStreamer {
	alternativeChannel?: string;
}

interface IPseudoSettingsSubscription {
	serviceName: string;
	uid: string;
	alternativeChannel?: string;
}

type SubscriptionFilter = {
	provider: string;
	uid?: string;
	username?: string;
};

type UserTarget = string | djs.Guild | djs.User;
type GuildTarget = string | djs.User | djs.Guild;

interface ISubscriptionRow {
	/**
	 * Provider if talking about module that fetches it, otherwise streaming service name
	 */
	provider: string;
	/**
	 * UID of the streamer
	 */
	uid: string;
	/**
	 * Username of the streamer
	 */
	username: string;
	/**
	 * Array of Guild IDs that subscribed to this channel
	 */
	subscribers: string[];
}

interface INotification {
	guild: string;
	provider: string;
	channelId: string;
	streamId: string;
	streamerId: string;
	messageId: string;
	sentAt: number;
}

interface IPseudoSubscription {
	provider: string;
	uid: string;
}
