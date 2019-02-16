import { IModule } from "@sb-types/ModuleLoader/Interfaces.new";
import { Message, Guild } from "discord.js";
import { INullableHashMap } from "../../../../types/Types";
import { PrefixAllDBController } from "./dbController";
import * as config from "@utils/config";
import { ModulePrivateInterface } from "@sb-types/ModuleLoader/PrivateInterface";
import { ErrorMessages } from "@sb-types/Consts";

export const DEFAULT_PREFIX = "!";
export const DEFAULT_MSGCACHE_DESTRUCTTIME = 60000;

/**
 * {PrefixAll} options
 */
interface IPrefixAllOptions {
	messagesCacheDestructionTime: number;
	defaultPrefix: string;
}

let coreInitialized = false;

export class PrefixAll implements IModule<PrefixAll> {
	public get defaultPrefix() {
		return this._defaultPrefix;
	}

	private readonly _prefixesCache: INullableHashMap<string[]> = Object.create(null);
	private readonly _messagesCache: INullableHashMap<ICachedCheck> = Object.create(null);
	private readonly _dbController: PrefixAllDBController = new PrefixAllDBController();
	private _defaultPrefix: string;
	private _messagesCacheDestructionTime: number;

	constructor() {
		if (coreInitialized) {
			throw new Error("You couldn't initialize this module second time. Please unload currently loaded module and try again");
		}

		coreInitialized = true;
	}

	public async supplyPrivateInterface(i: ModulePrivateInterface<PrefixAll>) {
		let cfg = (await config.instant<IPrefixAllOptions>(i))[1];

		cfg = {
			defaultPrefix: DEFAULT_PREFIX,
			messagesCacheDestructionTime: DEFAULT_MSGCACHE_DESTRUCTTIME,
			...cfg
		};

		this._defaultPrefix = cfg.defaultPrefix!;
		this._messagesCacheDestructionTime = cfg.messagesCacheDestructionTime!;
	}

	public async init() {
		await this._dbController.init();
	}
	
	private _cacheMessage(ctx: Message, result: CheckResult): CheckResult {
		let cached = this._messagesCache[ctx.id]; // checking if there's cached version

		if (cached) { // by some reason we got call, when it was already cached?
			const cachedResult = cached.result;
			if (!cached.destructTimer) {
				// okay, it's borked, let's re-cache it
				delete this._messagesCache[ctx.id];

				return this._cacheMessage(ctx, cachedResult);
			}

			return cachedResult;
		}

		// function to execute once timer fires
		const destructionFunction = (() => {
			const cached = this._messagesCache[ctx.id];
			if (cached) {
				cached.destructTimer = null;
				delete this._messagesCache[ctx.id];
			}
		});

		cached = this._messagesCache[ctx.id] = {
			cachedAt: Date.now(),
			destructTimer: setTimeout(destructionFunction, this._messagesCacheDestructionTime),
			result
		};

		// returning caching result

		return cached.result;
	}

	private async _getGuildPrefix(guild: Guild, defaultReplacement = true) {
		let cachedPrefixes = this._prefixesCache[guild.id];

		if (typeof cachedPrefixes === "undefined") {
			cachedPrefixes = this._prefixesCache[guild.id] = await this._dbController.getPrefixes(guild);
		}

		if (cachedPrefixes === null) { return defaultReplacement ? [this._defaultPrefix] : null; }

		return cachedPrefixes;
	}

	/**
	 * Checks if message starts with guild's prefixes
	 * @param message Message to check
	 */
	public async checkPrefix(message: Message) {
		const cached = this._messagesCache[message.id];
		if (cached) { // slight optimization
			return cached.result;
		}

		// no cached version
		if (!message.content || message.content.length === 0) {
			// that's absolutely no-no
			return this._cacheMessage(message, false);
		}

		if (!message.guild) { // only default prefix
			return this._cacheMessage(message, message.content.startsWith(this._defaultPrefix) && this.defaultPrefix);
		}

		const guildPrefix = await this._getGuildPrefix(message.guild);

		if (!guildPrefix || guildPrefix.length === 0) {
			// rare case, when absolutely no prefixes, even no default one
			return this._cacheMessage(message, false);
		}

		const foundPrefix = guildPrefix.find(prefix => message.content.startsWith(prefix));

		if (!foundPrefix) {
			return this._cacheMessage(message, false);
		}

		return this._cacheMessage(message, foundPrefix);
	}

	public async getPrefixes(guild: Guild) {
		if (!guild) { return [this.defaultPrefix]; }

		return this._getGuildPrefix(guild);
	}

	public async setPrefixes(guild: Guild, prefixes: string[] | null) {
		await this._dbController.setPrefixes(guild, prefixes);

		const newPrefixes = await this._dbController.getPrefixes(guild);
		if (!newPrefixes) { return this._prefixesCache[guild.id] = null; }

		return this._prefixesCache[guild.id] = newPrefixes;
	}

	public async unload(i: ModulePrivateInterface<PrefixAll>) {
		if (!i.isPendingUnload()) {
			throw new Error(ErrorMessages.NOT_PENDING_UNLOAD);
		}

		coreInitialized = false;

		return true;
	}
}

/**
 * Cached version of {PrefixAll#checkPrefix} result
 */
interface ICachedCheck {
	/**
	 * Timestamp when cache was created
	 */
	cachedAt: number;
	/**
	 * Result that was returned by {PrefixAll#checkPrefix}
	 */
	result: CheckResult;
	/**
	 * Timer of destruction
	 */
	destructTimer: NodeJS.Timer | null;
}

export type CheckResult = string | false;

export default PrefixAll;
