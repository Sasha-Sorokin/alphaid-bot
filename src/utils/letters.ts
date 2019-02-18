// #region Regional Indicator Converter

const LEAD_SURROGATE = String.fromCharCode(0xD83C);

const REGIONAL_INDICATORS_POS = 0xDDE6;
const LOWERCASE_LETTERS_POS = 0x61;

const REG_ISLETTERCONVERTABLE = /^[a-z]$/i;

export enum RegionalIndicatorsConversionFlags {
	/**
	 * Ignores case of any letter
	 */
	IgnoreCase = 2,
	/**
	 * Converts any keycap-convertable characters
	 */
	Keycaps = 4,
	/**
	 * Inserts spaces after each character
	 */
	InsertSpaces = 6
}

function hasFlag(flags: number, flag: number) {
	return (flags & flag) === flag;
}

interface IRegionalIndicatorsConversionOptions {
	flags?: RegionalIndicatorsConversionFlags;
	keycapVariant?: EmojiVariant;

	unknownCharacterReplacer?(s: string): string;
}

/**
 * Replaces all lowercase latin letters in the given string to the unicode regional indicators
 * @param str String to convert
 * @param options Options for converting or flags on it's own
 * @example
 * toRegionalIndicators("fr");
 * // => "🇫🇷"
 * toRegionalIndicators("owo", ConversionFlags.InsertSpaces);
 * // => "🇴 🇼 🇴"
 * toRegionalIndicators("FR 16", ConversionFlags.NumberKeycaps | ConversionFlags.IgnoreCase);
 * // => "🇫🇷 1️⃣6️⃣"
 */
export function toRegionalIndicators(str: string, options: IRegionalIndicatorsConversionOptions | RegionalIndicatorsConversionFlags): string {
	let lowercase = false;
	let convertNumbers = true;
	let addSpaces = true;

	if (typeof options === "number") {
		options = { flags: options };
	}

	const { flags, unknownCharacterReplacer } = options;
	
	if (flags != null && flags > 0) {
		lowercase = hasFlag(flags, RegionalIndicatorsConversionFlags.IgnoreCase);
		convertNumbers = hasFlag(flags, RegionalIndicatorsConversionFlags.Keycaps);
		addSpaces = hasFlag(flags, RegionalIndicatorsConversionFlags.InsertSpaces);
	}
	
	let { keycapVariant } = options;

	if (keycapVariant == null) keycapVariant = EmojiVariant.Emoji;

	const chars = str.match(keycapVariant === EmojiVariant.Emoji ? REG_KEYCAP_MATCHER : REG_ANYCHAR);

	if (chars == null) return "";

	let res = "";

	for (let i = 0, l = chars.length; i < l; i++) {
		let char = chars[i];

		const testableChar = lowercase ? char.toLowerCase() : char;

		if (REG_ISLETTERCONVERTABLE.test(testableChar)) {
			const offset = testableChar.charCodeAt(0) - LOWERCASE_LETTERS_POS;

			char = `${LEAD_SURROGATE}${String.fromCharCode(REGIONAL_INDICATORS_POS + offset)}`;
		} else if (convertNumbers && REG_ISKEYCAPCONVERTABLE.test(char)) {
			char = toKeycaps(char, keycapVariant);
		} else if (unknownCharacterReplacer) {
			char = unknownCharacterReplacer(char);
		}

		if (addSpaces) char += " ";

		res += char;
	}

	return res;
}

// #endregion

// #region Keycap Converter

const REG_ISKEYCAPCONVERTABLE = /^(\*|#|10|\d)$/;
const REG_KEYCAP_MATCHER = /(10|.)/gi;
const REG_ANYCHAR = /./g;

const KEYCAP_ENCLOSE = String.fromCharCode(0x20E3);

const EMOJI_TEN = "\uD83D\uDD1F";

const VARIANT_TEXT = String.fromCharCode(0xFE0E);
const VARIANT_EMOJI = String.fromCharCode(0xFE0F);

export const enum EmojiVariant {
	/**
	 * The sequence should be displayed as text
	 */
	Text = "text",
	/**
	 * The sequence should be displayed as emoji
	 */
	Emoji = "emoji",
	/**
	 * The sequence displaying determined by the rendering system
	 * 
	 * This is Discord-compatible variant
	 */
	Skip = "none"
}

/**
 * Replaces all numbers, asterisk and hash characters
 * in the given string via the keycap unicode emojis
 * @param num Number or string to convert
 * @param variant What emoji variant to use
 * @param unknownCharReplacer Function to replace other characters
 * @example
 * toKeycaps(16, EmojiVariant.Emoji);
 * // => "1️⃣6️⃣"
 * toKeycaps(10, EmojiVariant.Skip);
 * // => "1⃣0⃣"
 * toKeycaps(10, EmojiVariant.Emoji);
 * // => "🔟"
 */
export function toKeycaps(num: string | number, variant = EmojiVariant.Skip, unknownCharReplacer?: (s: string) => string) {
	let variantStr: string;

	switch (variant) {
		case EmojiVariant.Skip: 
			variantStr = "";
			break;
		case EmojiVariant.Emoji:
			variantStr = VARIANT_EMOJI;
			break;
		case EmojiVariant.Text:
			variantStr = VARIANT_TEXT;
			break;
		default: throw new Error("Unknown emoji variant");
	}

	const chars = `${num}`.match(variant === EmojiVariant.Emoji ? REG_KEYCAP_MATCHER : REG_ANYCHAR);

	if (!chars) return "";

	let res = "";

	for (let i = 0, l = chars.length; i < l; i++) {
		let char = chars[i];

		if (REG_ISKEYCAPCONVERTABLE.test(char)) char = `${char}${variantStr}${KEYCAP_ENCLOSE}`;
		else if (char === "10") char = EMOJI_TEN;
		else if (unknownCharReplacer) char = unknownCharReplacer(char);

		res += char;
	}

	return res;
}

// #endregion
