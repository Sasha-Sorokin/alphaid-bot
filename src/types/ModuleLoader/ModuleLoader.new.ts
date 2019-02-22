import { INullableHashMap } from "@sb-types/Types";
import * as logger from "loggy";
import * as path from "path";
import * as Interfaces from "@sb-types/ModuleLoader/Interfaces.new";
import { ModuleKeeper } from "@sb-types/ModuleLoader/ModuleKeeper.new";
import * as ModuleDiscovery from "./Discovery/ModuleDiscovery";
import * as semver from "semver";
import { EventEmitter } from "events";

// #region Interfaces and enums

/**
 * Configuration for the module loader
 */
export interface IModuleLoaderConfig {
	/**
	 * Module Loader name used in logs
	 */
	name: string;

	/**
	 * Disabled modules by their name
	 */
	disabled: string[];

	/**
	 * Directory to prototype modules from
	 */
	modulesPath: string;
}

// #endregion

// #region Module loader

export class ModuleLoader extends EventEmitter {
	/**
	 * Module name regular expression:
	 * 
	 * - Name may only contain the following:
	 *   - Latin letters (A-Z, case insensetive)
	 *   - `_`, `-`, `.`
	 *   - Any numbers
	 * - Name should be 3-32 chars in length
	 * 
	 * **Good**: `announcer`, `myMod.plugin`
	 * 
	 * **Bad**: `my pretty annoncer`, `myMod/plugin`
	 */
	public static moduleNameRegexp = /^[a-z\_.\-0-9]{3,32}$/i;

	/**
	 * Basic configuration used at loader initialization
	 */
	public readonly config: IModuleLoaderConfig;

	/**
	 * Informations about the modules
	 */
	private readonly _infos: INullableHashMap<Interfaces.IModuleInfo> = Object.create(null);

	/**
	 * Keepers for modules
	 */
	private readonly _keepers: INullableHashMap<ModuleKeeper<any>> = Object.create(null);

	/**
	 * Logger function
	 */
	private readonly _log: logger.ILogFunction;

	constructor(config: IModuleLoaderConfig) {
		this.config = config;
		this._log = logger(config.name);

		// tslint:disable-next-line:early-exit
		if (!path.isAbsolute(this.config.modulesPath)) {
			this.config.modulesPath = path.join(
				process.cwd(),
				this.config.modulesPath
			);
		}
	}

	/**
	 * Re-discovers all the modules
	 * @throws Throws an error if any module is providing invalid name
	 * @throws Throws an error if name of any module is already taken
	 * @throws Throws an error if any module has an invalid version
	 */
	public async rebuildRegistry() {
		this._log("verb", "Rebuilding registry...");

		const modules = await ModuleDiscovery.build(this.config.modulesPath);

		const checked: Interfaces.IModuleInfo[] = [];
		const takenNames: string[] = [];

		const modNameRegexp = ModuleLoader.moduleNameRegexp;

		for (let i = 0, l = modules.length; i < l; i++) {
			const mod = modules[i];

			if (!modNameRegexp.test(mod.name)) {
				throw new Error(`Incorrect name - "${mod.name}"`);
			}

			if (takenNames.includes(mod.name)) {
				throw new Error(`The name "${mod.name}" is taken already`);
			}

			if (this.config.disabled.includes(mod.name)) {
				this._log("verb", `Module "${mod.name}" is disabled`);

				continue;
			}

			takenNames.push(mod.name);

			checked.push(mod);
		}

		let logStr = "";

		const readyCount = checked.length;

		for (let i = 0; i < readyCount; i++) {
			const modInfo = checked[i];
		
			const current = this._infos[modInfo.name];

			if (current) {
				this._checkAndUpdate(current, modInfo);
			} else {
				this._infos[modInfo.name] = modInfo;
			}

			logStr += `\n\t- ${modInfo.name}@${modInfo.version} - ${modInfo.main}`;
		}

		this._log("verb", `Ready ${readyCount} modules:${logStr}`);

		this._prototypeAll();
		this._linkAll();
	}

	/**
	 * Checks and updates module info
	 * @param original Module info to update
	 * @param updated Updated module info from discovery
	 * @throws Throws an error if the names are different, which is a sign of invalid function usage
	 */
	private _checkAndUpdate(original: Interfaces.IModuleInfo, updated: Interfaces.IModuleInfo) {
		if (original.name !== updated.name) {
			throw new Error("The names are different and cannot be updated, the new module must be introduced");
		}

		original.main = updated.main;
		original.version = updated.version;

		for (const name in original.dependencies) {
			if (!updated.dependencies[name]) {
				delete original.dependencies[name];
			}
		}

		for (const name in updated.dependencies) {
			original.dependencies[name] = updated.dependencies[name];
		}
	}

	/**
	 * Makes prototypes out of dependencies
	 */
	private _prototypeAll() {
		this._log("verb", "Prototyping the modules...");

		let keepersPrototyped = 0;

		for (const name in this._infos) {
			if (this._keepers[name]) continue;

			const modInfo = this._infos[name]!;

			const modKeeper = new ModuleKeeper(modInfo);

			this._keepers[name] = modKeeper;

			keepersPrototyped++;
		}

		this._log("verb", `Prototyping complete - ${keepersPrototyped} keepers prototyped`);
	}

	/**
	 * Links all the modules with each other by their dependencies
	 * @throws Throws an error if some dependency is unable to satisfy version requirement and is not optional
	 */
	private _linkAll() {
		this._log("verb", "Linking dependencies...");

		let logStr = "";

		for (const modName in this._infos) {
			const modInfo = this._infos[modName]!;
			const modKeeper = this._getKeeper(modName);

			logStr += `\n\t${modName}@${modInfo.version}`;

			for (const depName in modInfo.dependencies) {
				let verRange = modInfo.dependencies[depName]!;

				const optional = verRange.endsWith("?");
				if (optional) verRange = verRange.slice(0, -1);

				const depInfo = this._infos[depName]!;

				if (!depInfo) {
					if (!optional) {
						throw new Error(`Dependency "${depName}" cannot be found`);
					}

					this._log("info", `Optional: Module "${modName}" requested "${depName}" but it cannot be found`);

					logStr += `\n\t  - MISSING: ${depName}: not found`;

					continue;
				}

				const depVersion = depInfo.version;

				if (!semver.satisfies(depVersion, verRange)) {
					if (!optional) {
						throw new Error(`Unable to satisfy requirement for "${depName}" of dependent "${modName}": ${verRange}`);
					}

					this._log("info", `Optional: Module "${modName}" requested "${depName}" but version "${depVersion}" unable to satisfy requirement of "${verRange}"`);

					logStr += `\n\t  - MISSING: ${depName}: version mismatch ("${depVersion}" vs "${verRange}")`;

					continue;
				}

				this._log("verb", `Linking "${depName}" to "${modName}": ${depInfo.version} satisfies ${verRange}`);

				const depKeeper = this._getKeeper(depName);

				modKeeper.addDependency(depKeeper);

				logStr += `\n\t  - ${depName}@${depInfo.version}`;
			}
		}

		this._log("verb", `Linked dependencies:${logStr}`);
	}

	/**
	 * Constructs all the modules
	 * @throws Throws an error if module fails to construct
	 */
	public async constructAll() {
		this._log("verb", "Construction started");

		this.emit(Interfaces.ModuleLoaderEvent.BeforeConstruction);

		let constructedCount = 0;

		for (const name in this._keepers) {
			const keeper = this._getKeeper(name);

			if (keeper.state !== Interfaces.ModuleLoadState.Prototype) {
				continue;
			}

			try {
				await keeper.construct();
			} catch (err) {
				this._log("err", `Unable to construct module "${name}":`, err);

				throw new Error(`Module "${name}" cannot be constructed. See logs for details`);
			}

			constructedCount++;
		}

		this.emit(Interfaces.ModuleLoaderEvent.PostConstruction, constructedCount);

		this._log("verb", `Construction done - ${constructedCount} modules constructed`);
	}

	/**
	 * Initializes all the modules
	 * @throws Throws an error if module fails to initializate
	 */
	public async initAll() {
		this._log("verb", "Initialization started");

		this.emit(Interfaces.ModuleLoaderEvent.BeforeInitialization);

		let initializedCount = 0;

		for (const name in this._keepers) {
			const keeper = this._getKeeper(name);

			if (keeper.state !== Interfaces.ModuleLoadState.Constructed) {
				continue;
			}

			try {
				await keeper.initialize();
			} catch (err) {
				this._log("err", `Unable to initialize module "${name}":`, err);

				throw new Error(`Module "${name}" cannot be initialized. See logs for details`);
			}

			initializedCount++;
		}

		this.emit(Interfaces.ModuleLoaderEvent.PostInitialization, initializedCount);

		this._log("verb", `Initialization complete - ${initializedCount} modules initialized`);
	}

	/**
	 * Unloads all the modules
	 * @throws Throws an error if module fails to unload
	 */
	public async unloadAll(reason = "modloader_default") {
		this._log("verb", `Unloading started - ${reason}`);

		this.emit(Interfaces.ModuleLoaderEvent.BeforeUnload, reason);

		let unloadedCount = 0;

		for (const name in this._keepers) {
			const keeper = this._getKeeper(name);

			if (keeper.state !== Interfaces.ModuleLoadState.Initialized) {
				continue;
			}

			await keeper.unload(reason);

			unloadedCount++;
		}

		this.emit(Interfaces.ModuleLoaderEvent.PostUnload, reason, unloadedCount);

		this._log("verb", `Unloading complete - ${unloadedCount} modules unloaded`);
	}

	/**
	 * Searches for the keeper by given name
	 * @param name Name to look up
	 */
	public getKeeper<T>(name: string) {
		return <ModuleKeeper<T>> this._keepers[name] || undefined;
	}

	/**
	 * Gets an keeper from the collection by its name or throws an error
	 * @param name Name to look up
	 * @throws Throws an error if keeper is not found
	 */
	private _getKeeper(name: string) {
		const keeper = this._keepers[name];

		if (!keeper) throw new Error(`No keeper found for "${name}"`);

		return keeper;
	}
}

// #endregion
