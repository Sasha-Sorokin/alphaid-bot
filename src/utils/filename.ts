function isHighSurrogate(codePoint: number) {
	return codePoint >= 0xd800 && codePoint <= 0xdbff;
}

function isLowSurrogate(codePoint: number) {
	return codePoint >= 0xdc00 && codePoint <= 0xdfff;
}

export function truncate(str: string, byteLength: number) {
	if (typeof str !== "string") {
		throw new Error("Input must be string");
	}

	const charLength = str.length;
	let curByteLength = 0;
	let codePoint: number;
	let segment: string;

	for (let i = 0; i < charLength; i += 1) {
		codePoint = str.charCodeAt(i);
		segment = str[i];

		if (isHighSurrogate(codePoint) && isLowSurrogate(str.charCodeAt(i + 1))) {
			i += 1;
			segment += str[i];
		}

		curByteLength += Buffer.byteLength(segment);

		if (curByteLength === byteLength) {
			return str.slice(0, i + 1);
		} else if (curByteLength > byteLength) {
			return str.slice(0, i - segment.length + 1);
		}
	}

	return str;
}

const illegalRe = /[\/\?<>\\:\*\|":]/g;
const controlRe = /[\x00-\x1f\x80-\x9f]/g;
const reservedRe = /^\.+$/;
const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const windowsTrailingRe = /[\. ]+$/;

function sanitize(input: string, replacement: string) {
	const sanitized = input
		.replace(illegalRe, replacement)
		.replace(controlRe, replacement)
		.replace(reservedRe, replacement)
		.replace(windowsReservedRe, replacement)
		.replace(windowsTrailingRe, replacement);

	return truncate(sanitized, 255);
}

interface ISanitizerOptions {
	/**
	 * Replacement for invalid characters
	 */
	replacement: string;
}

export function sanitizeFilename(fileName: string, options?: ISanitizerOptions) {
	const replacement = (options && options.replacement) || "_";
	const output = sanitize(fileName, replacement);

	if (replacement === "") return output;

	return sanitize(output, "");
}
