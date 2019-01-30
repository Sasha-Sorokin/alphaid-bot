import * as UserPreferences from "@utils/userPreferences";
import * as djs from "discord.js";
import fetch from "node-fetch";
import * as util from "util";
import { Humanizer } from "@sb-types/Localizer/Humanizer";
import { INullableHashMap } from "@sb-types/Types";
import * as ModuleLoaderBase from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "@cogs/plugin";
import * as db from "@utils/db";
import * as i18n from "@utils/ez-i18n";
import * as help from "@utils/help";
import { isPremium } from "@utils/premium";
import { timeDiff } from "@utils/time";
import * as utils from "@utils/utils";
import * as ProfilePluginBase from "./plugins/plugin";
import * as details from "@utils/failToDetail";
import * as getLogger from "loggy";
import * as ModuleLoaderInterfaces from "@sb-types/ModuleLoader/Interfaces";
import ModuleBase from "@sb-types/ModuleLoader/ModuleBase";

export interface IProfilesModuleConfig {
	emojis: {
		premium: string;
		admin: string;
		online: string;
		idle: string;
		dnd: string;
		streaming: string;
		offline: string;
		spotify: string;
	};
	plugins: ModuleLoaderInterfaces.IModuleInfo[];
}

export interface IDBUserProfile {
	real_name?: string;
	activity?: string;
	bio?: string;
	customize: string;
	guild_id: string;
	uid: string;
	joined: string;
	status_changed?: string;
}

export interface IUserActivity {
	link?: string;
	text: string;
	emoji: string;
}

const TABLE_NAME = "profiles";
const HELP_CATEGORY = "PROFILES";
const DB_PROFILE_PROPS = {
	real_name: "string?",
	activity: "number?",
	bio: "string?",
	customize: {
		default: "{}",
		type: "string"
	},
	guild_id: "string",
	uid: "string",
	joined: "string",
	status_changed: "string"
};

const MAX_PLUGINS_DEFAULT = 4;
const MAX_PLUGINS_PREMIUM = 6;

function isChat(msg: djs.Message) {
	return msg.channel.type === "text";
}

@help.command(HELP_CATEGORY, "profile", "loc:PROFILES_META_PROFILE", {
	"loc:PROFILES_META_PROFILE_ARG0": {
		optional: true,
		description: "loc:PROFILES_META_PROFILE_ARG0_DESC"
	}
}, isChat)
@help.command(HELP_CATEGORY, "set_bio", "loc:PROFILES_META_SETBIO", {
	"loc:PROFILES_META_SETBIO_ARG0": {
		optional: false,
		description: "loc:PROFILES_META_SETBIO_ARG0_DESC"
	}
}, isChat)
@help.command(HELP_CATEGORY, "edit_profile", "loc:PROFILES_META_EDITPROFILE", {
	"loc:PROFILES_META_EDITPROFILE_ARG0": {
		optional: false,
		description: "loc:PROFILES_META_EDITPROFILE_ARG0_DESC",
		values: ["remove", "set"]
	},
	"loc:PROFILES_META_EDITPROFILE_ARG1": {
		optional: false,
		description: "loc:PROFILES_META_EDITPROFILE_ARG1_DESC"
	},
	"loc:PROFILES_META_EDITPROFILE_ARG2": {
		optional: true,
		description: "loc:PROFILES_META_EDITPROFILE_ARG2_DESC"
	}
}, isChat)
@help.command(HELP_CATEGORY, "profile_plugins", "loc:PROFILES_META_PROFILEPLUGINS", undefined, isChat)
export default class Profiles extends Plugin implements ModuleLoaderInterfaces.IModule {
	public get signature() {
		return "snowball.features.profile";
	}

	private pluginsLoader: ModuleLoaderBase.ModuleLoader;
	private readonly log = getLogger("ProfilesJS");
	private readonly db = db.getDB();
	private readonly config: IProfilesModuleConfig;
	private readonly customHumanizers: INullableHashMap<Humanizer> = Object.create(null);

	constructor(config: IProfilesModuleConfig) {
		super({
			"message": async (msg: djs.Message) => {
				try {
					await this.onMessage(msg);
				} catch (err) {
					this.log("err", "Error handling message", err);
					$snowball.captureException(err, { extra: details.messageToExtra(err) });
				}
			},
			"presenceUpdate": async (oldPresence: djs.Presence | undefined, newPresence: djs.Presence) => {
				try {
					await this.onPresenсeUpdate(oldPresence, newPresence);
				} catch (err) {
					this.log("err", "Error handling user presence update", err);

					const additionalInfo = newPresence.member ? {
							member: details.memberToExtra(newPresence.member),
							guild: details.guildToExtra(newPresence.member.guild)
						} : {
							user: details.userToExtra(newPresence.user)
						};

					$snowball.captureException(err, {
						extra: {
							oldPresence: oldPresence,
							newPresence: newPresence,
							...additionalInfo
						}
					});
				}
			}
		}, true);

		for (const emojiName in config.emojis) {
			const emojiId = config.emojis[emojiName];
			const emoji = $discordBot.emojis.get(emojiId);
			if (!emoji) { throw new Error(`Emoji "${emojiName}" by ID "${emojiId}" wasn't found`); }
			config.emojis[emojiName] = emoji.toString();
		}

		this.config = Object.freeze(config);
	}

	// =====================================
	// MESSAGES HANDLING
	// =====================================

	private async onMessage(msg: djs.Message) {
		if (msg.channel.type !== "text") { return; }
		if (msg.content === "!profile_plugins") {
			this.cmd_profile_plugins(msg);
		} else if (msg.content.startsWith("!profile")) {
			this.cmd_profile(msg);
		} else if (msg.content.startsWith("!edit_profile")) {
			this.cmd_edit_profile(msg);
		} else if (msg.content.startsWith("!set_bio")) {
			this.cmd_set_bio(msg);
		}
		// else if(msg.content.startsWith("!status")) {
		// 	this.editActivity(msg);
		// }
	}

	private async onPresenсeUpdate(oldPresence: djs.Presence | undefined, newPresence: djs.Presence) {
		const member = newPresence.member;

		if (!member) {
			this.log("warn", `Presence update event for unknown member (user ${newPresence.user.id})`);

			return;
		}

		if (oldPresence) {
			if (
				!Profiles._isStatusChanged(oldPresence, newPresence) &&
				!Profiles._isPresenceChanged(oldPresence, newPresence)
			) {
				return;
			}
		}

		const profile = await this.getOrCreateProfile(member, member.guild);

		profile.status_changed = (new Date()).toISOString();

		await this.updateProfile(profile);
	}

	private static _isStatusChanged(oldPresence: djs.Presence, newPresence: djs.Presence) {
		return oldPresence.status !== newPresence.status;
	}

	private static _isPresenceChanged(oldPresence: djs.Presence, newPresence: djs.Presence) {
		if (oldPresence.activity && newPresence.activity) {
			if (oldPresence.activity.equals(newPresence.activity)) {
				return false; // game not changed ?
			}
		}

		return true;
	}

	// =====================================
	// MAIN FUNCTIONS
	// =====================================

	private async cmd_profile_plugins(msg: djs.Message) {
		let str = `# ${await i18n.localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_TITLE")}`;

		const names = Object.keys(this.pluginsLoader.loadedModulesRegistry);

		for (let i = 0, l = names.length; i < l; i++) {
			const name = names[i];
			const plugin = <ModuleBase<ProfilePluginBase.IProfilesPlugin>> this.pluginsLoader.loadedModulesRegistry[name];
			str += `\n- ${name}`;
			if (!plugin || !plugin.base) { return; }
			const plug = plugin.base;
			str += `\n  - : ${await i18n.localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_ARGUMENTS", {
				arguments: (await plug.getSetupArgs(msg.member)) || await i18n.localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_ARGUMENTS_EMPTY")
			})}\n`;
		}

		await msg.channel.send(str, {
			code: "md",
			split: true
		});
	}

	private async cmd_profile(msg: djs.Message) {
		let profileOwner: djs.GuildMember | undefined = undefined;

		if (msg.content === "!profile") {
			profileOwner = msg.member;
		} else if (msg.content.startsWith("!profile ")) {
			const mentionsCount = msg.mentions.users.size;
			if (mentionsCount === 1) {
				const mentioned = msg.mentions.users.first();

				if (!mentioned) { return; }

				if (!(profileOwner = msg.guild.members.get(mentioned.id))) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_NOTAMEMBER")
					});
				}
			} else if (mentionsCount > 1) {
				return; // as we don't show profiles fr more than one user
			} else {
				const searchTerm = msg.content.slice("!profile ".length);
				const rst = Date.now();
				const resolvedMember = await 
					utils
						.resolveGuildMember(
							searchTerm,
							msg.guild, {
								caseStrict: false,
								strict: false,
								possibleMention: false,
								fetch: false
							}
						)
						.catch(() => undefined);

				this.log("info", `Resolving hook took ${(Date.now() - rst)}ms on guild ${msg.guild.id} for search '${searchTerm}'`);

				if (!resolvedMember) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_NOTFOUND")
					});
				}

				profileOwner = resolvedMember;
			}
		}

		if (!profileOwner) {
			return;
		}

		const profile = await this.getOrCreateProfile(profileOwner, msg.guild);

		await this.sendProfile(msg, profile, profileOwner);
	}

	// private async addBadge(msg: Message) {
	// 	if(msg.author.id !== $botConfig.botOwner) {
	// 		return;
	// 	}

	// 	const args = msg.content.slice("!add_badge ".length).split(",").map(arg => arg.trim());
	// 	if(args.length !== 4) {
	// 		// uid, gid, add/remove, badgeid
	// 		await msg.channel.send({
	// 			embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_ADDBADGE_ARGSERR")
	// 		});
	// 		return;
	// 	}
	// }

	private async cmd_edit_profile(msg: djs.Message) {
		if (msg.content === "!edit_profile") {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msg.member, "PROFILES_PROFILE_DESCRIPTION")
			});
		}

		let param = msg.content.slice("!edit_profile ".length);
		const profile = await this.getOrCreateProfile(msg.member, msg.guild);

		if (param.startsWith("set ")) {
			param = param.slice("set ".length);
			const firstSpaceIndex = param.indexOf(" ");
			const arg = firstSpaceIndex !== -1 ? param.slice(firstSpaceIndex + 1) : "";
			param = param.slice(0, firstSpaceIndex === -1 ? param.length + 1 : firstSpaceIndex);

			if (param === "image") {
				const customize = JSON.parse(profile.customize);

				if (arg === "" || (!arg.startsWith("http://") && !arg.startsWith("https://"))) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_INVALID_LINK")
					});
				}

				try {
					await fetch(encodeURI(arg));
				} catch (err) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_DOWNLOAD_FAILED")
					});
				}

				customize["image_url"] = encodeURI(arg);
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, msg.member, "PROFILES_PROFILE_IMAGE_SET", {
						imageUrl: encodeURI(arg)
					})
				});

				profile.customize = JSON.stringify(customize);

				return this.updateProfile(profile);
			}

			const mod = this.pluginsLoader.findKeeper<ProfilePluginBase.IProfilesPlugin>(param, "name");

			if (!mod) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_404")
				});
			}

			if (mod.state !== ModuleLoaderInterfaces.ModuleLoadState.Initialized || !mod.base) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_NOT_LOADED")
				});
			}

			const plugin = mod.base;

			let completeInfo: ProfilePluginBase.IAddedProfilePlugin | undefined = undefined;
			try {
				completeInfo = await plugin.setup(arg, msg.member, msg, this);
			} catch (err) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_SETUP_FAILED", {
						fields: [{
							name: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_SETUP_FAILED:DETAILS"),
							value: `\`\`\`js\n${util.inspect(err)}\`\`\``
						}]
					})
				});
			}

			const customize = JSON.parse(profile.customize);

			if (!customize.plugins) {
				customize.plugins = {};
			}

			if (completeInfo.type === ProfilePluginBase.AddedProfilePluginType.Embed) {
				const embedsCount = Object.keys(customize.plugins).map(e => customize.plugins[e]).filter(e => e.type === ProfilePluginBase.AddedProfilePluginType.Embed).length;

				if (embedsCount > MAX_PLUGINS_DEFAULT && !(await isPremium(msg.member))) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, {
								key: "PROFILES_PROFILE_PREMIUMERR",
								formatOptions: {
									maxPlugins: MAX_PLUGINS_DEFAULT
								}
							}
						)
					});
				}

				if (embedsCount > MAX_PLUGINS_PREMIUM) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, {
								key: "PROFILES_PROFILE_MAXPLUGINSERR",
								formatOptions: {
									maxPlugins: MAX_PLUGINS_DEFAULT
								}
							}
						)
					});
				}
			}

			customize.plugins[param] = completeInfo;

			profile.customize = JSON.stringify(customize);

			await this.updateProfile(profile);

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Tada, msg.member, "PROFILES_PROFILE_SETUP_COMPLETE")
			});
		} else if (param === "set") {
			const strs = {
				key: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY"),
				value: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_VALUE"),
				keyDef: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY_DEFINITION"),
				valueDef: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_VALUE_DEFINITION")
			};

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member, {
						custom: true,
						string: `\`set [${strs.key}] [${strs.value}]\``
					}, {
						fields: [{
							name: `\`${strs.key}\``, inline: false, value: strs.keyDef
						}, {
							name: `\`${strs.value}\``, inline: false, value: strs.valueDef
						}]
					}
				)
			});
		} else if (param === "remove") {
			const strs = {
				key: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY"),
				keyDef: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY_DEFINITION")
			};

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msg.member, {
					custom: true,
					string: `\`remove [${strs.key}]\``
				}, {
						fields: [{
							name: `\`${strs.key}\``, inline: false, value: strs.keyDef
						}]
					})
			});
		} else if (param.startsWith("remove ")) {
			param = param.slice("remove ".length);

			const customize = JSON.parse(profile.customize);

			let doneStr = "";

			if (param === "image") {
				doneStr = await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_IMAGE_REMOVED");
				delete customize.image_url;
			} else {
				if (!this.pluginsLoader.loadedModulesRegistry[param]) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_404")
					});
				}
				delete customize.plugins[param];
				doneStr = await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_PLUGIN_REMOVED", {
					pluginName: param
				});
			}

			profile.customize = JSON.stringify(customize);

			await this.updateProfile(profile);

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, msg.member, `custom:${doneStr}`)
			});
		}
	}

	private async cmd_set_bio(msg: djs.Message) {
		if (msg.content === "!set_bio") {
			const strs = {
				aboutMe: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_ABOUTME"),
				def_aboutMe: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_ABOUTME_DEFINITON")
			};

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member, {
						custom: true,
						string: `\`!set_bio [${strs.aboutMe}]\``
					}, {
						fields: [{
							name: `\`${strs.aboutMe}\``,
							inline: false,
							value: strs.def_aboutMe
						}]
					}
				)
			});
		}

		const newBio = msg.content.slice("!set_bio ".length);
		if (newBio.length >= 1024) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "PROFILES_PROFILE_ARGS_ABOUTME_INVALIDTEXT")
			});
		}

		const profile = await this.getOrCreateProfile(msg.member, msg.guild);
		profile.bio = newBio;
		await this.updateProfile(profile);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, msg.member, "PROFILES_PROFILE_UPDATED")
		});
	}

	// async editActivity(msg:Message) {
	// }

	public getUserStatusEmoji(user: djs.User | djs.GuildMember | string) {
		switch (typeof user !== "string" ? user.presence.status : user) {
			case "online": { return this.config.emojis.online; }
			case "idle": { return this.config.emojis.idle; }
			case "dnd": { return this.config.emojis.dnd; }
			case "streaming": { return this.config.emojis.streaming; }
			default: { return this.config.emojis.offline; }
		}
	}

	public guessServiceEmoji(presenceName: string) {
		if (presenceName === "Spotify") {
			return this.config.emojis.spotify;
		}

		return "_";
	}

	public async getUserStatusString(activity: string, localizingFor: djs.GuildMember | djs.User) {
		let key = "";

		switch (activity) {
			case "online": { key = "online"; } break;
			case "idle": { key = "idle"; } break;
			case "dnd": { key = "dnd"; } break;
			default: { key = "offline"; } break;
		}

		return i18n.localizeForUser(localizingFor, `PROFILES_STATUS_${key.toUpperCase()}`);
	}

	public serverTimeHumanize(duration: number, largest: number = 2, round: boolean = true, language: string = $localizer.defaultLanguage) {
		let humanizer = this.customHumanizers[language];

		if (!humanizer) {
			humanizer = this.customHumanizers[language] = $localizer.createCustomHumanizer(language, {
				w: (weeks) => $localizer.getFormattedString(language, "PROFILES_PROFILE_MEMBERTIME:DURATION:WEEKS", { weeks }),
				m: (minutes) => $localizer.getFormattedString(language, "PROFILES_PROFILE_MEMBERTIME:DURATION:MINUTES", { minutes }),
				s: (seconds) => $localizer.getFormattedString(language, "PROFILES_PROFILE_MEMBERTIME:DURATION:SECONDS", { seconds })
			});

			if (!humanizer) { throw new Error("Expected to create new humanizer, but got nothing. Is world broken?"); }
		}

		return humanizer.humanize(duration, {
			largest, round
		});
	}

	private async sendProfile(msg: djs.Message, dbProfile: IDBUserProfile, target: djs.GuildMember) {
		const isBot = target.user.bot;

		let statusString = "";
		let showStatusChangeTime = true;

		if (target.presence.activity && !dbProfile.activity) {
			if (target.presence.activity.type === "STREAMING") {
				statusString += `${this.getUserStatusEmoji("streaming")} `;
				statusString += await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_STREAMING", {
					streamName: utils.escapeDiscordMarkdown(target.presence.activity.name),
					url: target.presence.activity.url
				});
			} else if (target.presence.activity.type === "PLAYING") {
				statusString += `${this.getUserStatusEmoji(target)} `;
				statusString += await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_PLAYING", {
					gameName: utils.escapeDiscordMarkdown(target.presence.activity.name)
				});
			} else if (target.presence.activity.type === "LISTENING") {
				const trackTitle = utils.escapeDiscordMarkdown(target.presence.activity.details);
				const albumTitle = utils.escapeDiscordMarkdown(target.presence.activity.assets.largeText);

				let trackLine = await i18n.localizeForUser(
					msg.member,
					"PROFILES_PROFILE_LISTENING_TRACK", {
						trackName: trackTitle,
						artists: utils.escapeDiscordMarkdown(
							target.presence.activity.state
								.split(";")
								.map(artistName => artistName.trim())
								.join(
									await i18n.localizeForUser(
										msg.member,
										"PROFILES_PROFILE_LISTENING_ARTISTS_SEPARATOR"
									)
								)
						)
					}
				);

				const serviceUrl =
					target.presence.activity["syncID"] &&
					`https://open.spotify.com/track/${target.presence.activity["syncID"]}`;

				trackLine = serviceUrl ? `[${trackLine}](${serviceUrl})` : trackTitle;

				if (albumTitle !== trackTitle) {
					// this is quite a bad check I suppose
					trackLine = await i18n.localizeForUser(
						msg.member,
						"PROFILES_PROFILE_LISTENING_ALBUM", {
							trackLine: trackLine,
							albumName: albumTitle
						}
					);
				}

				let listeningStatusString = await i18n.localizeForUser(
					msg.member,
					"PROFILES_PROFILE_LISTENING", {
						service: utils.escapeDiscordMarkdown(target.presence.activity.name),
						icon: this.guessServiceEmoji(target.presence.activity.name),
						trackLine
					}
				);

				// trimming spaces if no icon provided
				listeningStatusString = listeningStatusString
					.replace(/^ {1,}/g, "");

				statusString += `${this.getUserStatusEmoji(target)} `;
				statusString += listeningStatusString;

				showStatusChangeTime = false; // it's kinda not working in this case :9
			}
		} else if (dbProfile.activity) {
			const jsonActivity = <IUserActivity> JSON.parse(dbProfile.activity);

			statusString += jsonActivity.emoji;

			statusString += ` **${((text) => (jsonActivity.link ? `[${text}](${jsonActivity.link})` : text))(utils.escapeDiscordMarkdown(jsonActivity.text))}**`;
		} else {
			statusString += this.getUserStatusEmoji(target);
			statusString += await this.getUserStatusString(target.presence.status, msg.member);
		}

		if (target.id === $botConfig.botOwner) {
			statusString = `${this.config.emojis.admin} ${statusString}`;
		} else if ((await isPremium(target))) {
			statusString = `${this.config.emojis.premium} ${statusString}`;
		}

		const additionalBadges = await UserPreferences.getPreferenceValue(target.user, "profiles:badges", true);
		if (Array.isArray(additionalBadges)) {
			const badgesLine = additionalBadges.join(" ");
			statusString = `${badgesLine} ${statusString}`;
		}

		if (showStatusChangeTime) {
			if (!isBot && dbProfile.status_changed) {
				const changedAt = new Date(dbProfile.status_changed).getTime();
				const diff = Date.now() - changedAt;
				const sDiff = this.serverTimeHumanize(diff, 2, true, await i18n.getUserLanguage(msg.member));
				statusString += ` (${sDiff})`;
			} else {
				statusString += ` (${(await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_BOT")).toUpperCase()})`;
			}
		}

		const fields: utils.IEmbedOptionsField[] = [];

		if (dbProfile.bio) {
			fields.push({
				inline: false,
				name: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_ABOUTME"),
				value: dbProfile.bio
			});
		}

		let pushedMessage: djs.Message | undefined = undefined;

		let joinedDate = new Date(dbProfile.joined).getTime();

		if (joinedDate === 0) {
			dbProfile.joined = target.joinedAt.toISOString();
			await this.updateProfile(dbProfile);
			joinedDate = target.joinedAt.getTime();
		}

		const embed = <utils.IEmbed> {
			author: {
				icon_url: target.user.displayAvatarURL({ format: "webp", size: 128 }),
				name: target.displayName
			},
			title: dbProfile.real_name ? dbProfile.real_name : undefined,
			description: statusString,
			fields: fields,
			footer: {
				text: joinedDate !== 0 ? await i18n.localizeForUser(msg.member, !isBot ? "PROFILES_PROFILE_MEMBERTIME" : "PROFILES_PROFILE_BOTADDED", {
					duration: this.serverTimeHumanize(timeDiff(joinedDate, Date.now(), "ms"), 2, true, await i18n.getUserLanguage(msg.member))
				}) : await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_MEMBERTIME_NOTFOUND"),
				icon_url: msg.guild.iconURL({ format: "webp", size: 128 })
			},
			image: undefined,
			thumbnail: target.user.avatar ? {
				url: target.user.displayAvatarURL(target.user.avatar.startsWith("a_") ? { format: "gif" } : { format: "png", size: 512 })
			} : undefined,
			timestamp: target.user.createdAt.toISOString()
		};

		let pushing = false;
		let repushAfterPush = false;

		const pushUpdate = async () => {
			if (pushing) {
				repushAfterPush = true;

				return;
			}

			pushing = true;
			if (!pushedMessage) {
				pushedMessage = <djs.Message> await msg.channel.send({ embed: <any> embed });
				pushing = false;

				if (repushAfterPush) {
					repushAfterPush = true;
					pushUpdate();
				}

				return pushedMessage;
			}
			try {
				pushedMessage = await pushedMessage.edit({ embed: <any> embed });
				pushing = false;
			} catch (err) {
				repushAfterPush = true;
			}

			if (repushAfterPush) {
				repushAfterPush = false;
				await utils.sleep(100);
				await pushUpdate();
			}

			return pushedMessage;
		};

		if (dbProfile.customize === "{}") {
			return pushUpdate();
		}

		const customize = JSON.parse(dbProfile.customize);

		if (customize.image_url) {
			embed.image = { url: customize.image_url };
		}

		if (customize.video_url) {
			embed.video = { url: customize.video_url };
		}

		if (!customize.plugins) {
			return pushUpdate();
		}

		for (const pluginName of Object.keys(customize.plugins)) {
			const plugin = this.pluginsLoader.findBase<ProfilePluginBase.IProfilesPlugin>(pluginName, "name");
			if (!plugin) { continue; }

			const addedPlugin = <ProfilePluginBase.IAddedProfilePlugin> customize.plugins[pluginName];

			switch (addedPlugin.type) {
				case ProfilePluginBase.AddedProfilePluginType.Embed: {
					if (!plugin.getEmbed) { continue; }

					const fNum = fields.length;

					fields.push({
						name: pluginName,
						value: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_LOADING"),
						inline: true
					});

					const pluginLogPrefix = `${dbProfile.uid} -> ${pluginName}|`;

					let canEdit = true;
					const t: NodeJS.Timer = setTimeout(async () => {
						this.log("err", pluginLogPrefix, "timed out.");
						canEdit = false;
						fields[fNum] = {
							name: pluginName,
							value: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_TIMEDOUT"),
							inline: true
						};
						pushUpdate();
					}, 20000);

					plugin.getEmbed(addedPlugin.json, msg.member, this).then(field => {
						if (!canEdit) { return; }
						if (t) { clearTimeout(t); }
						fields[fNum] = field;
						if (pushedMessage && ((Date.now() - pushedMessage.createdAt.getTime()) / 1000) < 3) {
							setTimeout(pushUpdate, 1000);
						} else {
							pushUpdate();
						}
					}).catch(async (err) => {
						this.log("err", pluginLogPrefix, "Error at plugin", err);
						if (t) { clearTimeout(t); }
						fields[fNum] = {
							name: pluginName,
							value: await i18n.localizeForUser(msg.member, "PROFILES_PROFILE_FAILED", {
								msg: err.message
							})
						};
						pushUpdate();
					});
				} break;
				case ProfilePluginBase.AddedProfilePluginType.Customs: {
					if (!plugin.getCustoms) { continue; }

					const pluginLogPrefix = `${dbProfile.uid} -> ${pluginName}|`;

					let canEdit = true;
					const t: NodeJS.Timer = setTimeout(() => {
						this.log("err", pluginLogPrefix, "timed out.");
						canEdit = false;
					}, 20000);

					plugin.getCustoms(addedPlugin.json, msg.member, this).then(customs => {
						if (!canEdit) { return; }
						if (t) { clearTimeout(t); }
						if (customs.image_url) {
							embed.image = { url: customs.image_url };
						}
						if (customs.thumbnail_url) {
							embed.thumbnail = { url: customs.thumbnail_url };
						}
						pushUpdate();
					}).catch(err => {
						this.log("err", pluginLogPrefix, "Error at plugin", err);
						if (t) { clearTimeout(t); }
					});
				} break;
			}
		}
		await pushUpdate();
	}

	// =====================================
	// WORKING WITH DATABASE
	// =====================================

	public async createProfile(member: djs.GuildMember, guild: djs.Guild) {
		member = await member.guild.members.fetch(member.id);

		return this.db(TABLE_NAME).insert({
			uid: member.id,
			real_name: null,
			guild_id: guild.id,
			bio: null,
			activity: null,
			customize: "{}",
			joined: member.joinedTimestamp ? new Date(member.joinedTimestamp) : undefined,
			status_changed: (new Date()).toISOString()
		});
	}

	public async updateProfile(dbProfile: IDBUserProfile) {
		return this.db(TABLE_NAME).where({
			uid: dbProfile.uid,
			guild_id: dbProfile.guild_id
		}).update(dbProfile);
	}

	public async getProfile(member: djs.GuildMember, guild: djs.Guild): Promise<IDBUserProfile> {
		return this.db(TABLE_NAME).where({
			guild_id: guild.id,
			uid: member.id
		}).first();
	}

	public async getOrCreateProfile(member: djs.GuildMember, guild: djs.Guild) {
		let currentUser = await this.getProfile(member, guild);
		if (!currentUser) {
			await this.createProfile(member, guild);
			currentUser = await this.getProfile(member, guild);
		} else {
			return currentUser;
		}

		if (!currentUser) {
			throw new Error("User cannot be created at current moment.");
		}

		return currentUser;
	}


	// =====================================
	// PLUGIN SCRIPTS
	// =====================================

	public async init() {
		const options = this.config;

		let status = false;
		try {
			status = await this.db.schema.hasTable(TABLE_NAME);
		} catch (err) {
			$snowball.captureException(err);
			this.log("err", "Can't check table status: ", err);

			return;
		}

		if (!status) {
			this.log("warn", "Table is not created, creating...");
			try {
				await db.createTableBySchema(TABLE_NAME, DB_PROFILE_PROPS);
				this.log("ok", "Table is created!");
			} catch (err) {
				$snowball.captureException(err);
				this.log("err", "Cannot create table right now", err);

				return;
			}
		}

		const plugins = ModuleLoaderBase.convertToModulesMap(options.plugins);

		this.pluginsLoader = new ModuleLoaderBase.ModuleLoader({
			name: "Profiles:Plugins",
			basePath: "./cogs/profiles/plugins/",
			registry: plugins,
			defaultSet: Object.getOwnPropertyNames(plugins)
		});

		await this.pluginsLoader.loadModules();

		this.handleEvents();
	}

	public async unload() {
		await this.pluginsLoader.unload(Object.getOwnPropertyNames(this.pluginsLoader.loadedModulesRegistry));

		this.unhandleEvents();

		return true;
	}
}

module.exports = Profiles;
