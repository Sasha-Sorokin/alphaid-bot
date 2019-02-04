import { promises as fs } from "fs";
import * as YAML from "js-yaml";
import * as path from "path";
import { ModulePrivateInterface, ConfigFormat } from "@sb-types/ModuleLoader/PrivateInterface";

type ConfigObject<T> = Partial<T> | undefined;

/**
 * Reads the file in UTF-8
 * @param filename Path to the file to read
 * @returns Returns file content or `undefined` if file cannot be read
 */
async function readFile(filename: string) {
	try {
		return await fs.readFile(filename, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Reads the YAML configuration file
 * @param filename Path to the YAML config file to read
 * @returns An parsed object or `undefined` if file cannot be read or parsed
 */
export async function readYAML<T>(filename: string) : Promise<Partial<T> | undefined> {
	const content = await readFile(filename);

	if (!content) return undefined;

	try {
		return YAML.safeLoad(content);
	} catch {
		return undefined;
	}
}

/**
 * Reads the JSON configuration file
 * @param filename Path to the JSON config file to read
 * @returns An parsed object or `undefined` if file cannot be read or parsed
 */
export async function readJSON<T>(filename: string) : Promise<ConfigObject<T>> {
	const content = await readFile(filename);

	if (!content) return undefined;

	try {
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

interface IConfigOptions {
	/**
	 * Config file name
	 */
	configName?: string;
	/**
	 * Config format
	 */
	format: ConfigFormat;
}

/**
 * Instant config reading options
 */
interface IConfigReadOptions extends IConfigOptions {
	/**
	 * Rename the file that cannot be read
	 * 
	 * The corrupted file will be renamed to `filename-timestamp.errored-extension`
	 * (example: `integrations-1548632206746.errored-yml`)
	 */
	renameErrored?: boolean;
}

interface IConfigWriteOptions extends IConfigOptions {
	/**
	 * Rename the old config before writing a new one to the same path
	 * 
	 * The old config file will be renamed to `filename-timestamp.old-extension`
	 */
	renameOld?: boolean;
}

const DEFAULT_READ_OPTIONS: IConfigReadOptions = {
	format: ConfigFormat.YAML,
	renameErrored: true
};

const DEFAULT_WRITE_OPTIONS: IConfigWriteOptions = {
	format: ConfigFormat.YAML
};

/**
 * Renames the config file due to reason
 * @param configPath Path to the config file
 * @param type Type of the config file (will be put in extension)
 */
async function renameConfig(configPath: string, type: "errored" | "old") {
	const ext = path.extname(configPath);

	const newPath = `${path.basename(configPath, ext)}-${Date.now().toFixed(0)}.${type}-${ext}`;

	return fs.rename(configPath, newPath);
}

/**
 * Checks whether path does exist or not
 * @param path Path to check
 * @returns `true` if path exists, otherwise `false`
 */
async function doesExist(path: string) {
	try {
		await fs.access(path);

		return true;
	} catch (err) {
		if (err.code !== "ENOENT") throw err;

		return false;
	}
}

/**
 * Writes config to the file
 * @param i Module's private interface to obtain config information from
 * @param config Config object
 * @param opts Options of writing config, such as name and format
 * @returns Path to the config file
 */
export async function saveInstant<T>(i: ModulePrivateInterface<any>, config: T, opts = DEFAULT_WRITE_OPTIONS) {
	const content = opts.format === ConfigFormat.YAML
		? YAML.safeDump(config)
		: JSON.stringify(config);

	const configFilePath = i.getConfigFilePath(opts.configName, opts.format);

	const configDirPath = path.dirname(configFilePath);

	try {
		if (!(await doesExist(configDirPath))) {
			await fs.mkdir(configDirPath, { recursive: true });
		}

		if (await doesExist(configFilePath)) {
			await renameConfig(configFilePath, "old");
		}
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}

	await fs.writeFile(configFilePath, content, { encoding: "utf8" });

	return configFilePath;
}

type ConfigReadResult<T> = [string, ConfigObject<T>];

/**
 * Obtains information about the specified config file and reads it
 * 
 * May replace corrupted files, see `IConfigOptions`
 * @param i Module's public interface to obtain config information from
 * @param opts Options of reading config, such as name, format
 * @returns Array where first element is the path to the config file and
 * the second element is the partial config object or `undefined` if config cannot be read.
 * Partial because the config can be modified by the host and values can be missing
 */
export async function instant<T>(i: ModulePrivateInterface<any>, opts = DEFAULT_READ_OPTIONS) : Promise<ConfigReadResult<T>> {
	const configFilePath = i.getConfigFilePath(opts.configName, opts.format);

	const content = await readFile(configFilePath);

	if (!content) return [configFilePath, undefined];

	let obj: ConfigObject<T>;

	try {
		switch (opts.format) {
			case ConfigFormat.JSON: {
				obj = JSON.parse(content);
			} break;
			case ConfigFormat.YAML: {
				obj = YAML.safeLoad(content);
			} break;
		}
	} catch {
		if (opts.renameErrored) {
			await renameConfig(configFilePath, "errored");
		}

		return [configFilePath, undefined];
	}

	return [configFilePath, obj];
}
