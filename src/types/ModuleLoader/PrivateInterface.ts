import { sanitizeFilename } from "@utils/filename";
import { ModuleBase } from "./ModuleBase.new";
import { ModulePublicInterface } from "./PublicInterfaces";
import * as path from "path";
import { promises as fs } from "fs";

const KEEPER_REFERENCES = new WeakMap<ModulePrivateInterface<any>, ModuleBase<any>>();

const CONFIG_BASEPATH = path.join(process.cwd(), "config");

export const enum ConfigFormat {
	YAML = "yml",
	JSON = "json"
}

/**
 * Private interface to interact with module keeper
 */
export class ModulePrivateInterface<T> {
	constructor(keeper: ModuleBase<T>) {
		KEEPER_REFERENCES.set(this, keeper);
	}

	/**
	 * Gets name of the module
	 */
	public getName() {
		return KEEPER_REFERENCES.get(this)!.info.name;
	}

	/**
	 * Checks if keeper and the base are connected with each other
	 * 
	 * Use this function to validate a real call from the keeper or a fake one
	 * @param base Base to check
	 * @throws Throws an error if base is invalid
	 * @returns `true` if provided base the same in the keeper
	 */
	public baseCheck(base: T) {
		if (KEEPER_REFERENCES.get(this)!.base !== base) {
			throw new Error("Invalid base");
		}

		return true;
	}

	public getDependent<T = any>(name: string) : ModulePublicInterface<T> | undefined {
		const dependent = KEEPER_REFERENCES.get(this)!.dependents.find(_ => _.info.name === name);

		if (!dependent) return;

		return dependent.publicInterface;
	}

	/**
	 * Gets module dependents
	 * @returns Dependents public interfaces
	 */
	public getDependents() {
		return KEEPER_REFERENCES.get(this)!.dependents.map(_ => _.publicInterface);
	}

	/**
	 * Finds a dependency by its name
	 * @param name Dependency name
	 * @throws Throws an error if dependency is not found
	 * @returns Dependency public interface
	 */
	public getDependency<T = any>(name: string) : ModulePublicInterface<T> | undefined {
		const dependency = KEEPER_REFERENCES.get(this)!.dependencies.find(_ => _.info.name === name);

		if (!dependency) return;

		return dependency.publicInterface;
	}

	/**
	 * Gets module dependencies
	 * @returns Dependencies public interfaces
	 */
	public getDependencies() {
		return KEEPER_REFERENCES.get(this)!.dependencies.map(_ => _.publicInterface);
	}

	/**
	 * Gets configs path
	 * @todo This method will be moved to the `configs` property
	 */
	public getConfigsPath() {
		return path.join(CONFIG_BASEPATH, this.getName());
	}

	/**
	 * Resolves the configs list
	 * 
	 * Does not resolve default config, use `getConfigPath` method instead.
	 * @returns The pathes of the config files
	 * @example
	 * this._privateInterface.getConfigsList();
	 * // -> ["/opt/app/config/module/integrations.yml"]
	 * @todo This method will be moved to the `configs` property
	 */
	public async getConfigsList() {
		const list: string[] = [];

		try {
			const configsPath = this.getConfigsPath();

			const files = await fs.readdir(configsPath);
			
			for (let i = 0, l = files.length; i < l; i++) {
				const file = files[i];

				const filePath = path.join(configsPath, file);

				const stat = await fs.stat(file);

				if (!stat.isFile()) continue;

				list.push(filePath);
			}
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
		}
	
		return list;
	}

	/**
	 * Generates a path to the specified config name
	 * @param filename Filename (if not specified, uses a module name in root config folder)
	 * @param fmt Config file format
	 * @throws Will throw an error if sanitized (clean) filename is empty
	 * @returns Path to the specified config file. If `filename` wasn't specified, this is
	 * a file with module name in root configs directory, otherwise it's a
	 * file within a folder with module name
	 * @example
	 * this._privateInterface.getConfigFilePath()
	 * // -> "/opt/app/config/module.yml"
	 * this._privateInterface.getConfigFilePath("integrations")
	 * // -> "/opt/app/config/module/integrations.yml"
	 * @todo This method will be moved to the `configs` property
	 */
	public getConfigFilePath(filename?: string, fmt = ConfigFormat.YAML) {
		const ext = fmt === ConfigFormat.JSON ? ".json" : ".yml";
		const pathParts = [CONFIG_BASEPATH];

		if (filename) pathParts.push(this.getName());
		else filename = this.getName();

		const sanitizedFn = sanitizeFilename(`${filename}${ext}`);

		if (sanitizedFn === ext) {
			throw new Error(`Invalid config name`);
		}

		pathParts.push(sanitizedFn);

		return path.join(...pathParts);
	}

	/**
	 * Checks if module is really pending initialization
	 * @returns `true` if module is pending initialization, otherwise `false`
	 */
	public isPendingInitialization() : boolean {
		return KEEPER_REFERENCES.get(this)!.getPendingState() === "initialization";
	}

	/**
	 * Checks if module is really pending unload
	 * @returns `true` if module is pending unload, otherwise `false`
	 */
	public isPendingUnload() : boolean {
		return KEEPER_REFERENCES.get(this)!.getPendingState() === "unload";
	}
}
