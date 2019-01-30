import * as getLogger from "loggy";
import { promises as fs } from "fs";
import * as path from "path";
import * as YAML from "js-yaml";

const LOG = getLogger("ModuleDiscoveryUtils");

/**
 * List subdirectories in the provided directory
 * @param directory Directory to list subdirectories of
 * @returns An array of pathes to subdirectories
 */
export async function subdirectories(directory: string) {
	LOG("verbose", `Searching subdirectories: "${directory}"`);

	const subdirectories: string[] = [];

	const pathes = await fs.readdir(directory);

	for (let i = 0, l = pathes.length; i < l; i++) {
		const normalizedPath = path.join(directory, pathes[i]);

		const stat = await fs.stat(normalizedPath);

		if (stat.isDirectory()) subdirectories.push(normalizedPath);
	}

	return subdirectories;
}

/**
 * Safely reads the file
 * @param fileName File to read
 * @returns The file content or undefined
 */
export async function safeRead(fileName: string) {
	LOG("verbose", `Safely read: "${fileName}"`);

	try {
		return await fs.readFile(
			fileName, {
				encoding: "utf8"
			}
		);
	} catch {
		return undefined;
	}
}

/**
 * Safely loads the YAML
 * @param content YAML string to parse
 * @returns Parsed object or `undefined`
 */
export async function safeLoadYAML<T>(content: string) : Promise<T | undefined> {
	LOG("verbose", `Safely load YAML: ${content.length} chars`);

	try {
		return <T> YAML.safeLoad(content);
	} catch {
		return undefined;
	}
}

/**
 * Normalizes a file name
 * @param fileName Path to normalize
 * @param origin Origin of the file
 * @returns Full path to the file within or not the origin
 */
export function normalizeFileName(fileName: string, origin: string) {
	const normalized = path.isAbsolute(fileName)
		? fileName
		: path.join(origin, fileName);

	LOG("verbose", `Normalize filename: "${fileName}" -> "${normalized}"`);

	return normalized;
}

/**
 * Checks if the path belongs to the directory
 * @param path Path to check
 * @param origin Origin of the path
 * @throws Throws an error if path does not belong to the specified origin
 */
export async function pathPrecaution(path: string, origin: string) {
	if (!path.startsWith(origin) || path === origin) {
		throw new Error(`Incorrect path: "${path}"`);
	}
}
