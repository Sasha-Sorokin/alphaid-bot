import { Whitelist } from "@cogs/whitelist/whitelist";
import { EmbedType } from "@utils/utils";
import { stripSpaces } from "@utils/text";
import { Plugin } from "@cogs/plugin";
import { Message } from "discord.js";
import { randomNumber, randomPick } from "@utils/random";
import { PrefixAll } from "../core/prefixAll";
import { IModule } from "@sb-types/ModuleLoader/Interfaces.new";
import { ModulePrivateInterface } from "@sb-types/ModuleLoader/PrivateInterface";
import { ModulePublicInterface } from "@sb-types/ModuleLoader/PublicInterfaces";
import * as getLogger from "loggy";
import * as interactive from "@utils/interactive";
import * as i18n from "@utils/ez-i18n";
import * as Command from "@utils/command";

const DEFAULT_LIMITATIONS = <IPrefixAllPluginLimitations> {
	non_partners: 2, // 1 additional prefix?
	partners: 6
};

export const ATTEMPTS_STARS = [
	"https://i.imgur.com/XgY13z9.png",
	"https://i.imgur.com/0NJqMTo.png",
	"https://i.imgur.com/oWjUCrH.png",
	"https://i.imgur.com/Zfpy5Sj.png"
];

let instanceInitialized = false;

export class PrefixAllPlugin extends Plugin implements IModule<PrefixAllPlugin> {
	private _prefixAllInterface: ModulePublicInterface<PrefixAll>;
	private _whitelistInterface: ModulePublicInterface<Whitelist>;
	private readonly _log = getLogger("PrefixAllPlugin");
	private readonly _allowNoWhitelistHandling: boolean;
	private readonly _limitations: IPrefixAllPluginLimitations;

	constructor(options: IPrefixAllPluginOptions) {
		super({
			"message": (msg) => this._onMessage(msg)
		}, true);

		if (instanceInitialized) {
			throw new Error("Could not initializate the prefix all plugin another time. Only one instance could work at the same time");
		}

		this._allowNoWhitelistHandling = !!options.allowNoWhitelistHandling;
		this._limitations = options.limitations && (options.limitations.non_partners && options.limitations.partners) ? options.limitations : DEFAULT_LIMITATIONS;
	}

	public async init(i: ModulePrivateInterface<PrefixAllPlugin>) {
		this._log("info", "Searching for `PrefixAll` core");

		const prefixAllInterface = i.getDependency<PrefixAll>("prefixall");

		if (!prefixAllInterface) {
			this._log("err", "Keeper not found, could not load");

			return; // should throw?
		}

		this._prefixAllInterface = prefixAllInterface;

		this._log("info", "Searching for `Whitelist` core");
		const whitelistKeeper = i.getDependency<Whitelist>("legacy-whitelist");

		if (whitelistKeeper) {
			this._whitelistInterface = whitelistKeeper;
		} else {
			this._log("warn", "Whitelist keeper not found");
		}

		instanceInitialized = true;

		this.handleEvents();
	}

	private async _onMessage(msg: Message) {
		// TODO: the current method is extra costly, should attach instance to the events
		// currently slighty optimizing this query by removing state checking
		if (!this._prefixAllInterface) { return; }

		// for later usage and ensurance of non-null value of instance creating the constant
		// (!) this is probably memory costly as it's getting executing for every message
		const prefixAllInstance = this._prefixAllInterface.getBase();
		if (!prefixAllInstance) { return undefined; } // no instance means errored loading, or invalid state

		const prefix = await prefixAllInstance.checkPrefix(msg);
		if (!prefix) { return undefined; } // prefix not found, returning

		const parsed = Command.parse(msg.content.slice(prefix.length));
		if (parsed.command !== "prefix") { return undefined; } // checking if there's no command call

		if (!parsed.subCommand) {
			// if there's no subcommand then sending helpful message
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO",
					formatOptions: {
						items: await i18n.localizeForUser(msg.member, "PREFIXALL_INFO_ITEMS")
					}
				})
			});
		}

		switch (parsed.subCommand.toLowerCase()) { // otherwise let's switch to the best one
			// TODO: (done) passing instance of prefixall instead of repetitive searching and checking \
			// if instance is already loaded. Improves some .ms time.
			case "add": case "+": return this.subcmd_add(msg, parsed, prefix, prefixAllInstance);
			case "remove": case "-": return this.subcmd_remove(msg, parsed, prefix, prefixAllInstance);
			case "list": case "?": return this.subcmd_list(msg, parsed, prefix, prefixAllInstance);
		}

		return undefined;
	}

	private async _isNotServer(msg: Message) {
		if (msg.channel.type !== "text") {
			await msg.channel.send({ embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.author, "PREFIXALL_WRONGCHANNELTYPE") });

			return true;
		}

		return false;
	}

	private async subcmd_add(msg: Message, parsed: Command.ICommandParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		if (await this._isNotServer(msg)) { return; }
		const cmd = `${prefix}${parsed.command}`;

		if (!parsed.arguments) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO_ADD",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const additionalPrefix = stripSpaces(msg.content.slice(cmd.length + 1 + parsed.subCommand!.length));

		let guildPrefixes = await prefixAllInstance.getPrefixes(msg.guild);

		if (!guildPrefixes) {
			this._log("info", `#add: prefixAllInstance.getPrefixes(${msg.guild.id}): Returned none prefixes! Fallback to [] used`);
			guildPrefixes = [];
		}

		if (guildPrefixes.includes(additionalPrefix)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_ALREAYADDED")
			});
		}

		const whitelistInstance = this._whitelistInterface.getBase();

		if (!whitelistInstance && !this._allowNoWhitelistHandling) {
			this._log("warn", "`Whitelist` module instance not found!");

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_INTERNALERROR")
			});
		}

		const limitation = whitelistInstance && (await whitelistInstance.isWhitelisted(msg.guild)) ? this._limitations.partners : this._limitations.non_partners;

		if (guildPrefixes.length >= limitation) { // inclusive

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_PREFIX_LIMITEXCEED",
					formatOptions: {
						limit: guildPrefixes.length
					}
				})
			});
		}

		const confirmation = await interactive.createConfirmationMessage(await i18n.generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "PREFIXALL_PREFIX_CONFIRMATION_ADD",
			formatOptions: {
				prefix: additionalPrefix
			}
		}), msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_CANCELED")
			});
		}

		guildPrefixes.push(additionalPrefix);

		await prefixAllInstance.setPrefixes(msg.guild, guildPrefixes);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "PREFIXALL_PREFIX_ADDED",
				formatOptions: {
					prefix: additionalPrefix
				}
			})
		});
	}

	private async subcmd_remove(msg: Message, parsed: Command.ICommandParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		if (await this._isNotServer(msg)) { return; }
		const cmd = `${prefix}${parsed.command}`;

		if (!parsed.arguments) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO_REMOVE",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const prefixToRemoval = stripSpaces(msg.content.slice(cmd.length + 1 + parsed.subCommand!.length));

		const guildPrefixes = await prefixAllInstance.getPrefixes(msg.guild);

		if (!guildPrefixes) {
			this._log("info", `#remove: prefixAllInstance.getPrefixes(${msg.guild.id}): Returned none prefixes!`);

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_NOPREFIXES")
			});
		}

		if (guildPrefixes.length === 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msg.member, "PREFIXALL_PREFIX_CANTREMOVELATEST")
			});
		}

		const index = guildPrefixes.indexOf(prefixToRemoval);

		if (index === -1) {
			const star = randomNumber(0, 7) === 6;

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, {
					custom: true,
					string: (await i18n.localizeForUser(msg.member, "PREFIXALL_PREFIX_NOTFOUND")) + (star ? (`\n${await i18n.localizeForUser(msg.member, "PREFIXALL_PREFIX_NOTFOUND_6")}`) : "")
				}, star ? {
					imageUrl: randomPick(ATTEMPTS_STARS)
				} : undefined)
			});
		}

		const confirmation = await interactive.createConfirmationMessage(await i18n.generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "PREFIXALL_PREFIX_CONFIRMATION_REMOVE",
			formatOptions: {
				prefix: prefixToRemoval
			}
		}), msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_CANCELED")
			});
		}

		guildPrefixes.splice(index, 1);

		await prefixAllInstance.setPrefixes(msg.guild, guildPrefixes);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "PREFIXALL_PREFIX_REMOVED",
				formatOptions: {
					prefix: prefixToRemoval
				}
			})
		});
	}

	private async subcmd_list(msg: Message, parsed: Command.ICommandParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		const cmd = `${prefix}${parsed.command}`;
		const msgAuthor = msg.member || msg.author;

		if (parsed.arguments) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msgAuthor, {
					key: "PREFIXALL_INFO_LIST",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const guildPrefixes = await prefixAllInstance.getPrefixes(msg.guild);

		if (!guildPrefixes) {
			this._log("info", `#list: prefixAllInstance.getPrefixes(${msg.guild.id}): Returned none prefixes!`);
			// hello something

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Error, msgAuthor, "PREFIXALL_PREFIX_LIST_NONE")
			});
		}

		if (msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msgAuthor, {
					key: "PREFIXALL_PREFIX_LIST_DM",
					formatOptions: { prefix: guildPrefixes[0] }
				})
			});
		}

		const items: string[] = [];

		for (const prefix of guildPrefixes) {
			items.push(await i18n.localizeForUser(msgAuthor, "PREFIXALL_PREFIX_LISTITEM", {
				prefix
			}));
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(EmbedType.Information, msgAuthor, {
				key: "PREFIXALL_PREFIX_LIST",
				formatOptions: {
					items: items.join("\n")
				}
			})
		});
	}

	public async unload() {
		this.unhandleEvents();
		instanceInitialized = false;

		return true;
	}
}

interface IPrefixAllPluginLimitations {
	/**
	 * For non-partnered / not whitelisted servers
	 */
	non_partners: number;
	/**
	 * For partners / whitelisted servers
	 */
	partners: number;
}

interface IPrefixAllPluginOptions {
	/**
	 * Limitations of prefixes.
	 * Allowing to have many prefixes to everyone could case many performance problems for depending plugins. Recommended count - less than 5 prefixes.
	 */
	limitations: IPrefixAllPluginLimitations;
	/**
	 * Allows handling prefix adding requests when whitelist module not found.
	 * If disabled (default), prints error and denies request.
	 */
	allowNoWhitelistHandling: boolean;
}

export default PrefixAllPlugin;
