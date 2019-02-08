import { Guild, GuildMember, GuildEmojiStore, Message, User } from "discord.js";
import { replaceAll } from "@utils/text";
import { INullableHashMap, IHashMap } from "@sb-types/Types";

/**
 * Stringifies JS Error to the JSON
 * @param err Error to stringify
 * @param filter JSON filter
 * @param space Number of spaces or string to use for indentantion
 * @deprecated This method is deprecated an will be removed in future
 * @returns JSON for the passed Error object
 */
export function stringifyError(err: Error, filter = null, space = 2) {
	const plainObject = Object.create(null);

	for (const key of Object.getOwnPropertyNames(err)) {
		plainObject[key] = err[key];
	}

	return JSON.stringify(plainObject, filter, space);
}

/**
 * Converts color integer to the HEX code
 * @param color Color integer to convert
 * @returns Padded HEX color from the integer
 * @example
 * colorNumberToHex(role.color)
 * // => "ffff00"
 */
export function colorNumberToHex(color: number) {
	let hex = color.toString(16);

	while (hex.length < 6) hex = `0${hex}`;

	return `${hex}`.toUpperCase();
}

/**
 * Converts object to the ES6 Map
 * @param obj Object to convert
 */
export function objectToMap<T>(obj: IHashMap<T>) {
	const map = new Map<string, T>();
	for (const key of Object.keys(obj)) {
		map.set(key, obj[key]);
	}

	return map;
}

/**
 * Options for the `escapeDiscordMarkdown` function
 */
interface IEscapingOptions {
	/**
	 * Whether to escape underlines safely or not
	 * 
	 * Escaping safely means that only double, starting and
	 * ending underlines will be escaped. On the other hand
	 * unsafe method escapes **any** underline characters instead
	 */
	unsafeUnderlines?: boolean;
	/**
	 * Whether to escape square brackets or not
	 * 
	 * Square brackets are used for the links in webhook
	 * messages and the inside embeds
	 */
	squareBrackets?: boolean;
	/**
	 * Whether to escape spoiler tokens (`||`) or not
	 */
	spoilers?: boolean;
}

const DEFAULT_ESCAPING_OPTIONS: IEscapingOptions = {
	unsafeUnderlines: false,
	squareBrackets: false,
	spoilers: true
};

/**
 * Escapes string from the following Discord markdown:
 * - Backquotes for code
 * - Asterisks for bold and italic fonts
 * - Underlines (with safe and unsafe method)
 * - Vertical pipes for spoiler tags
 * - Double tlide for striken through text
 * 
 * Beware that escaping may increase string lenght
 * @param str String to escape
 * @param underlines Whether to escape underlines or not
 */
export function escapeDiscordMarkdown(str: string, options = DEFAULT_ESCAPING_OPTIONS) {
	str = replaceAll(str, "`", "'");
	str = replaceAll(str, "*", "\\*");
	str = replaceAll(str, "~~", "\\~\\~");

	if (options.squareBrackets) {
		str = replaceAll(str, "[", "\\[");
		str = replaceAll(str, "]", "\\]");
	}

	if (options.spoilers) {
		str = replaceAll(str, "||", "\\|\\|");
	}

	if (options.unsafeUnderlines) {
		str = replaceAll(str, "_", "\\_");
	} else {
		str = replaceAll(str, " _", " \\_");
		str = replaceAll(str, "_ ", "\\_ ");
		str = replaceAll(str, "__", "\\_\\_");
	}

	return str;
}

/**
 * Type of the embed decorations
 */
export const enum EmbedType {
	/**
	 * Embed will have a red color and “no entry” sign (🚫) as icon
	 */
	Error = "error",
	/**
	 * Embed will have a green color and check mark as icon
	 */
	OK = "ok",
	/**
	 * Embed will have a sky blue color and “i” letter as icon
	 */
	Information = "information",
	/**
	 * Embed will have a dark blue color and question mark as icon
	 */
	Progress = "progress",
	/**
	 * Embed will not be decorated at all
	 */
	Empty = "empty",
	/**
	 * Embed will have a green color, check mark as icon and party party popper emoji (🎉) as small thumbnail
	 */
	Tada = "tada",
	/**
	 * Embed will have a blue color and question mark as icon
	 */
	Question = "question",
	/**
	 * Embed will have an yellow color, exclamation mark as icon and small thumbnail
	 */
	Warning = "warning"
}
// customFooter?:string

/**
 * Field in the embed
 */
export interface IEmbedOptionsField {
	/**
	 * Name of the field shown at the top
	 * 
	 * Maximum 32 characters
	 */
	name: string;
	/**
	 * Value of the field
	 * 
	 * Maximum 256 characters
	 */
	value: string;
	/**
	 * Whether field must be shown at the same line or on the following one
	 * 
	 * Only three field can be put on the same line with maximum size of the client's window
	 */
	inline?: boolean;
}

/**
 * General options for the embed
 */
export interface IEmbedOptions {
	/**
	 * Text to show in footer
	 */
	footerText?: string;
	/**
	 * Footer options
	 * 
	 * Overrides `footerText` option
	 */
	footer?: {
		/**
		 * Text to show in footer
		 */
		text: string;
		/**
		 * Icon to show in footer
		 */
		icon_url?: string;
	};
	/**
	 * Color of embed border
	 */
	color?: number;
	/**
	 * Author to show in embed
	 * 
	 * Replaces `author` provided by selected `EmbedType`
	 */
	author?: {
		/**
		 * Author's name
		 */
		name: string,
		/**
		 * Author's icon URL
		 */
		icon_url?: string;
		/**
		 * Author's URL
		 */
		url?: string;
	};
	/**
	 * Fields in embed
	 */
	fields?: IEmbedOptionsField[];
	/**
	 * Title to show on top of message
	 */
	title?: string;
	/**
	 * If `type` is `error`, replaces default "Error" string with value of this property
	 */
	errorTitle?: string;
	/**
	 * If `type` is `ok`, replaces default "Success!" string with value of this property
	 */
	okTitle?: string;
	/**
	 * If `type` is `informative`, replaces default "Information" string with value of this property
	 */
	informationTitle?: string;
	/**
	 * If `type` is `tada`, replaces default "Tada!" string with value of this property
	 */
	tadaTitle?: string;
	/**
	 * If `type` is `progress`, replaces default "Loading..." string with value of this property
	 */
	progressTitle?: string;
	/**
	 * If `type` is `question`, replaces default "Confirmation..." string with value of this property
	 */
	questionTitle?: string;
	/**
	 * If `type` is `warning`, replaces default "Warning!" string with value of this property
	 */
	warningTitle?: string;
	/**
	 * Replaces default string of any type of embed with value of this property
	 */
	universalTitle?: string;
	/**
	 * URL of image to show in embed
	 */
	imageUrl?: string;
	/**
	 * Removes footer in embed
	 * Useful while footer provided by selected `EmbedType` doesn't fit your needs :pray:
	 */
	clearFooter?: boolean;
	/**
	 * URL of thumbnail to show in embed
	 */
	thumbUrl?: string;
	/**
	 * Thumbnail's width
	 */
	thumbWidth?: number;
	/**
	 * Thumbnail's height
	 */
	thumbHeight?: number;
	/**
	 * Timestamp
	 */
	ts?: Date;
}

/**
 * Generated embed
 * @ignore
 */
export interface IEmbed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string | number;
	color?: number;
	footer?: {
		text: string;
		icon_url?: string;
	};
	image?: {
		url: string;
		height?: number;
		width?: number;
	};
	thumbnail?: {
		url: string;
		height?: number;
		width?: number;
	};
	video?: {
		url: string;
		height?: number;
		width?: number;
	};
	provider?: {
		name: string;
		url?: string;
	};
	author?: {
		icon_url?: string;
		name: string;
		url?: string;
	};
	fields?: IEmbedOptionsField[];
}

/**
 * Icon for the embed based on type
 */
export const enum EmbedIcon {
	/**
	 * Red no entry sign on white background
	 */
	Error = "https://i.imgur.com/tNDFOYI.png",
	/**
	 * White “i” letter on sky blue background
	 */
	Information = "https://i.imgur.com/AUIYOy6.png",
	/**
	 * White check mark on green background
	 */
	OK = "https://i.imgur.com/MX3EPo8.png",
	/**
	 * Rotating gears on grey background
	 */
	Progress = "https://i.imgur.com/Lb04Jg0.gif",
	/**
	 * Dark question mark on grey background
	 */
	Question = "https://i.imgur.com/lujOhUw.png",
	/**
	 * Black question mark on yellow background
	 */
	Warning = "https://i.imgur.com/Ga60TCT.png",
	/**
	 * Party popper on transparent background
	 */
	Tada = "https://i.imgur.com/ijm8BHV.png"
}

/**
 * Title for the embed based on type
 */
export const enum EmbedTitle {
	Error = "Error",
	Information = "Information",
	OK = "Success!",
	Tada = "Tada!",
	Progress = "Loading…",
	Question = "Confirmation…",
	Warning = "Warning!"
}

/**
 * Embed color based on type
 */
export const enum EmbedColor {
	/**
	 * Red color
	 */
	Error = 0xDD2E44,
	/**
	 * Sky blue color
	 */
	Information = 0x3B88C3,
	/**
	 * Green color
	 */
	OK = 0x77B255,
	/**
	 * Blue color
	 */
	Progress = 0x546E7A,
	/**
	 * Grey color
	 */
	Question = 0xCCD6DD,
	/**
	 * Yellow color
	 */
	Warning = 0xFFCC4D
}

/**
 * Generates a fancy stylized embed by pre-defined parameters
 * @param type Type of the embed
 * @param description Description to put after title
 * @param options Additional options for the embed
 */
export function generateEmbed(type: EmbedType, description: string | undefined, options?: IEmbedOptions) {
	const embed: any = {};

	embed.author = {};
	embed.description = description;

	switch (type) {
		case EmbedType.Error: {
			embed.author.name = (options && options.errorTitle)
				|| EmbedTitle.Error;

			embed.author.icon_url = EmbedIcon.Error;

			embed.color = EmbedColor.Error;
		} break;
		case EmbedType.Information: {
			embed.author.name = (options && options.informationTitle)
				|| EmbedTitle.Information;

			embed.author.icon_url = EmbedIcon.Information;

			embed.color = EmbedColor.Information;
		} break;
		case EmbedType.OK: {
			embed.author.name = (options && options.okTitle)
				|| EmbedTitle.OK;

			embed.author.icon_url = EmbedIcon.OK;

			embed.color = EmbedColor.OK;
		} break;
		case EmbedType.Tada: {
			embed.author.name = (options && options.tadaTitle)
				|| EmbedTitle.Tada;

			embed.author.icon_url = EmbedIcon.OK;

			embed.thumbnail = {
				url: EmbedIcon.Tada
			};

			embed.color = EmbedColor.OK;
		} break;
		case EmbedType.Progress: {
			embed.author.name = (options && options.progressTitle)
				|| EmbedTitle.Progress;

			embed.author.icon_url = EmbedIcon.Progress;

			embed.color = EmbedColor.Progress;
		} break;
		case EmbedType.Question: {
			embed.author.name = (options && options.questionTitle)
				|| EmbedTitle.Question;

			embed.author.icon_url = EmbedIcon.Question;

			embed.color = EmbedColor.Question;
		} break;
		case EmbedType.Warning: {
			embed.author.name = (options && options.warningTitle)
				|| EmbedTitle.Warning;

			embed.author.icon_url = EmbedIcon.Warning;
			
			embed.thumbnail = {
				url: EmbedIcon.Warning
			};

			embed.colors = EmbedColor.Warning;
		} break;
		case EmbedType.Empty: {
			embed.author = undefined;
		} break;
	}

	if (options) {
		if (options.title) embed.title = options.title;

		if (options.fields) embed.fields = options.fields;

		if (options.universalTitle && embed.author) {
			embed.author.name = options.universalTitle;
		}

		if (options.author) embed.author = options.author;

		if (options.footer) {
			embed.footer = options.footer;

			if (options.footerText) {
				embed.footer.text = options.footerText;
			}
		} else if (options.footerText) {
			embed.footer = {
				text: options.footerText
			};
		} else if (type !== EmbedType.Empty && $discordBot.user) {
			embed.footer = {
				text: $discordBot.user.username,
				icon_url: $discordBot.user.displayAvatarURL({ format: "webp", size: 128 })
			};
		}

		if (options.clearFooter) embed.footer = undefined;

		if (options.imageUrl) {
			embed.image = {
				url: options.imageUrl
			};
		}

		if (options.thumbUrl) {
			embed.thumbnail = {
				url: options.thumbUrl
			};

			if (options.thumbWidth && options.thumbWidth > 0) {
				embed.thumbnail.width = options.thumbWidth;
			}

			if (options.thumbHeight && options.thumbHeight > 0) {
				embed.thumbnail.height = options.thumbHeight;
			}
		}

		if (options.color) embed.color = options.color;

		if (options.ts) embed.timestamp = options.ts.toISOString();
	}

	return embed;
}

/**
 * Default options for resolving
 */
interface IResolveOptions {
	/**
	 * Should name strictly equal to search
	 */
	strict: boolean;
	/**
	 * Is search case-sensetive
	 */
	caseStrict: boolean;
}

const DEFAULT_ROLE_RESOLVE_OPTIONS: IResolveOptions = {
	strict: true,
	caseStrict: false
};

export const SNOWFLAKE_REGEXP = /^[0-9]{16,20}$/;

/**
 * Solves the query to the guild role
 * @param query Name of the role or it's ID
 * @param guild Guild which role to resolve
 * @param options Options for the resolving
 * @returns Guild role or `undefined` if no matches found
 */
export function resolveGuildRole(query: string, guild: Guild, options?: Partial<IResolveOptions>) {
	if (SNOWFLAKE_REGEXP.test(query)) {
		// can be ID
		const role = guild.roles.get(query);
		if (role) { return role; }
	}

	const {
		strict,
		caseStrict
	} = {
		...DEFAULT_ROLE_RESOLVE_OPTIONS,
		...options
	};

	if (!caseStrict) {
		query = query.toLowerCase();
	}

	const roles = guild.roles.array();

	// going to search
	for (let i = 0, l = roles.length; i < l; i++) {
		const role = roles[i];
		const roleName = (caseStrict ? role.name : role.name.toLowerCase());

		if (strict) {
			if (roleName === query) {
				return role;
			}

			continue;
		}

		if (roleName.includes(query)) {
			return role;
		}
	}

	return undefined;
}

type ChannelType = "text" | "voice" | "category";

/**
 * Options for channel resolving
 */
interface IGuildChannelResolveOptions extends IResolveOptions {
	/**
	 * Can search contain channel mention to parse
	 */
	possibleMention: boolean;
	/**
	 * Which channel types to match
	 */
	types: ChannelType[];
}

const DEFAULT_CHANNEL_RESOLVE_OPTIONS: IGuildChannelResolveOptions = {
	strict: true,
	caseStrict: false,
	possibleMention: false,
	types: ["text", "voice"]
};

const CHANNEL_MENTION_SNOWFLAKE = /^\<\#([0-9]{16,20})\>$/;

/**
 * Resolves the query to the guild channel
 * @param query Name of the channel or its ID
 * @param guild Guild which channel to resolve
 * @param options Options for the resolving
 * @returns Guild channel or `undefined` if no matches found
 */
export function resolveGuildChannel(query: string, guild: Guild, options?: Partial<IGuildChannelResolveOptions>) {
	const {
		strict,
		caseStrict,
		possibleMention,
		types
	} = {
		...DEFAULT_CHANNEL_RESOLVE_OPTIONS,
		...options
	};

	if (possibleMention) {
		const res = CHANNEL_MENTION_SNOWFLAKE.exec(query);
		if (res && res[1]) {
			const channel = guild.channels.get(res[1]);
			if (channel) { return channel; }
		}
	}

	if (SNOWFLAKE_REGEXP.test(query)) {
		const ch = guild.channels.get(query);
		if (ch) { return ch; }
	}

	if (!caseStrict) {
		query = query.toLowerCase();
	}

	const channels = guild.channels.array();

	for (let i = 0, l = channels.length; i < l; i++) {
		const channel = channels[i];

		if (!types.includes(<any> channel.type)) { continue; }

		const channelName = caseStrict ? channel.name : channel.name.toLowerCase();

		if (strict) {
			if (channelName === query) {
				return channel;
			}

			continue;
		}

		if (channelName.includes(query)) {
			return channel;
		}
	}

	return undefined;
}

const USER_MENTION_SNOWFLAKE = /^\<\@\!?([0-9]{16,20})\>$/;

/**
 * It's not actually that safe, just returns undefined on error
 * @param guild Guild from where member comes
 * @param id ID of member
 * @param errCallback Callback to call on error
 */
export async function safeMemberFetch(guild: Guild, id: string, errCallback?: (err) => void) {
	try {
		return guild.members.get(id) || await guild.members.fetch(id);
	} catch (err) {
		if (errCallback) { errCallback(err); }

		return undefined;
	}
}

/**
 * Options for member resolving
 */
interface IGuildMemberResolveOptions extends IResolveOptions {
	/**
	 * Can search contain user mention to parse
	 */
	possibleMention: boolean;
	/**
	 * Fetch members list before the search?
	 */
	fetch: boolean;
}

const DEFAULT_MEMBER_RESOLVE_OPTIONS: IGuildMemberResolveOptions = {
	strict: false,
	caseStrict: false,
	possibleMention: false,
	fetch: false
};

/**
 * Resolves the query to the guild member
 * @param query Username / nickname of the member or its ID
 * @param guild Guild which member to resolve
 * @param options Options for the resolving
 * @returns Guild member or `undefined` if no matches found
 */
export async function resolveGuildMember(query: string, guild: Guild, options?: Partial<IGuildMemberResolveOptions>): Promise<GuildMember | undefined> {
	const {
		strict,
		caseStrict,
		possibleMention,
		fetch
	} = {
		...DEFAULT_MEMBER_RESOLVE_OPTIONS,
		...options
	};

	if (possibleMention) {
		const res = USER_MENTION_SNOWFLAKE.exec(query);
		if (res && res[1]) {
			const member = await safeMemberFetch(guild, res[1]);
			if (member) { return member; }
		}
	}

	if (SNOWFLAKE_REGEXP.test(query)) {
		const member = safeMemberFetch(guild, query);
		if (member) { return member; }
	}

	if (!caseStrict) {
		query = query.toLowerCase();
	}

	let tagParts_discrim: undefined | string = undefined;
	let tagParts_username: undefined | string = undefined;

	// tag parts
	let isTag = false;

	{
		const hashIndex = query.lastIndexOf("#");
		if (hashIndex !== -1) {
			const username = query.slice(0, hashIndex).replace(/\@/g, "");
			if (username.length > 0) { tagParts_username = username; }
			tagParts_discrim = query.slice(hashIndex + 1);
			isTag = true;
		}
	}

	const membersArray = fetch ? (await guild.members.fetch()).array() : guild.members.array();

	for (let i = 0, l = membersArray.length; i < l; i++) {
		const member = membersArray[i];
		const username = caseStrict ? member.user.username : member.user.username.toLowerCase();

		if (isTag) { // tag strict equality check
			if (tagParts_discrim !== member.user.discriminator) {
				continue;
			}

			if (tagParts_username) {
				if (strict && username !== tagParts_username) {
					continue;
				} else if (username.indexOf(tagParts_username) === -1) {
					continue;
				}
			}

			return member;
		}

		const nickname = member.nickname ? (caseStrict ? member.nickname : member.nickname.toLowerCase()) : undefined;

		switch (strict) {
			case true: {
				if ((nickname && nickname === query) || username === query) {
					return member;
				}
			} break;
			case false: {
				if ((nickname && (nickname.indexOf(query) !== -1)) || (username.indexOf(query) !== -1)) {
					return member;
				}
			} break;
		}
	}

	return undefined;
}

/**
 * Pretty prints the user's name
 * @param user User which name to pretty print
 * @param includeTag Whether should be user tag included or not
 * @param includeAt Whether should be name prefixed with `@` or not
 */
export function getUserDisplayName(user: GuildMember | User, includeTag = false, includeAt = false) : string {
	let displayName: string;

	if (user instanceof GuildMember) {
		displayName = user.displayName;
		if (includeTag) {
			displayName += `#${user.user.discriminator}`;
		}
	} else {
		displayName = user.username;
		if (includeTag) {
			displayName += `#${user.discriminator}`;
		}
	}

	if (includeAt) {
		displayName = `@${displayName}`;
	}

	return displayName;
}

/**
 * Sets timeout before resolving the promise
 * @param delay Time before the Promise will be resolved
 * @param value Value to resolve promise with
 * @returns Passed `value`
 * @example
 * const helloWorld = await sleep(1000, "Hello, world!");
 * // After one second:
 * // => "Hello, world!"
 */
export function sleep<T>(delay: number = 1000, value?: T): Promise<T> {
	return new Promise<T>((resolve) => {
		setTimeout(() => {
			resolve(value);
		}, delay);
	});
}

/**
 * Resolves a map of the emoji ID to the map of emoji strings to use
 * @param emojis Map of the emoji IDs to resolve
 * @param store Store to resolve emojis from
 * @param strict Whether to throw or not an error if emoji not found or ID is incorrect
 * @returns Hash map of resolved emojis for actual use
 * @example
 * resolveEmojiMap({ silly: "1234567890123456" }, $discordBot.emojis, true)
 * // => { silly: "<:sillyFace:1234567890123456>" }
 * // or
 * // Error: Emoji with ID "1234567890123456" by key "silly" not found
 * resolveEmojiMap({ foolingAround: "you tried" }, $discordBot.emojis, true)
 * // Error: Invalid Emoji ID provided by key "foolingAround" - "you tried"
 */
export function resolveEmojiMap(emojis: INullableHashMap<string>, store: GuildEmojiStore, strict = true): INullableHashMap<string> {
	const resolvedEmojisMap = Object.create(null);

	for (const emojiKey in emojis) {
		const emojiId = emojis[emojiKey]!;

		// raw cases
		if (emojiId.startsWith("raw:")) {
			resolvedEmojisMap[emojiKey] = emojiId.slice(3); // 3 - length
			continue;
		}

		if (!SNOWFLAKE_REGEXP.test(emojiId)) {
			if (strict) {
				throw new Error(`Invalid Emoji ID provided by key "${emojiKey}" - "${emojiId}"`);
			}

			continue;
		}

		const resolvedEmoji = store.get(emojiId);

		if (strict && !resolvedEmoji) {
			throw new Error(`Emoji with ID "${emojiId}" by key "${emojiKey}" not found`);
		}

		resolvedEmojisMap[emojiKey] = resolvedEmoji ? resolvedEmoji.toString() : null;
	}

	return resolvedEmojisMap;
}

/**
 * Fetches the guild member who wrote the passed message
 * @param msg Message received on the guild
 * @returns
 * - `undefined` if message created by hook or received from DM channel
 * - `undefined` if message sent by unknown member that cannot be fetched from API
 * - Guild member if message sent on the guild by the real member
 */
export async function getMessageMember(msg: Message): Promise<GuildMember | undefined> {
	if (msg.channel.type !== "text") return undefined;
	if (msg.webhookID) return undefined; // webhooks

	let member = msg.member;

	if (!member) {
		if (msg.author) {
			try {
				member = await msg.guild.members.fetch(msg.author);
			} catch (err) {
				return undefined;
			}
		} else {
			return undefined;
		}
	}

	return member;
}

/**
 * Fetches the author of message or guild member based
 * on where message has been received from
 * @param msg Message received in DM or a guild
 * @returns
 * - `undefined` if message created by hook
 * - `undefined` if message sent by unknown author
 * - `author` if message sent in DM channel
 * - Possibly guild member
 * @see getMessageMember The `getMessageMember` used if condition
 * “not DM channel” and “not webhook” meet, look at it for details
 * on how member is being resolved from message
 */
export async function getMessageMemberOrAuthor(msg: Message): Promise<GuildMember | User | undefined> {
	if (msg.channel.type !== "text") return msg.author;
	else if (msg.webhookID) return undefined;

	return getMessageMember(msg);
}
