import { INullableHashMap, IHashMap } from "@sb-types/Types";
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

	/**
	 * Resolves npm modules having the following in the directory name
	 */
	nodeModulesPrefix?: string;
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
	private readonly _infos: INullableHashMap<Interfaces.IModuleInfo[]> = Object.create(null);

	/**
	 * Keepers for modules
	 */
	private readonly _keepers: INullableHashMap<Array<ModuleKeeper<any>>> = Object.create(null);

	/**
	 * Keepers mapped by the module information
	 */
	private readonly _infoMappedKeepers = new WeakMap<Interfaces.IModuleInfo, ModuleKeeper<any>>();

	private readonly _allKeepers: Array<ModuleKeeper<any>> = [];

	/**
	 * Logger function
	 */
	private readonly _log: logger.ILogFunction;

	constructor(config: IModuleLoaderConfig) {
		super();

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

		let modules = await ModuleDiscovery.build(this.config.modulesPath);

		const { nodeModulesPrefix } = this.config;

		if (nodeModulesPrefix != null) {
			this._log("info", `Enabled loading of modules from node_modules directory with prefix: ${nodeModulesPrefix}`);

			modules = modules.concat(
				await ModuleDiscovery.buildNodeModules(nodeModulesPrefix)
			);
		}

		const modNameRegexp = ModuleLoader.moduleNameRegexp;

		const discovered: INullableHashMap<Interfaces.IModuleInfo[]> = Object.create(null);

		for (let i = 0, l = modules.length; i < l; i++) {
			const mod = modules[i];

			if (!modNameRegexp.test(mod.name)) {
				throw new Error(`Incorrect name - "${mod.name}"`);
			}

			if (this.config.disabled.includes(mod.name)) {
				this._log("verb", `Modules with name "${mod.name}" are disabled`);

				continue;
			}

			if (!(mod.name in discovered)) {
				discovered[mod.name] = [mod];

				continue;
			}

			const alternatives = discovered[mod.name];

			if (alternatives == null) {
				throw new Error(`Incorrect state has occured: discovered["${mod.name}"] supposed to be not defined at all, not set to ${alternatives}`);
			}

			// mod@0.3.2 -A <- allowed
			// mod@0.6.1 NA
			// mod@0.6.2 NA
			// mod@0.7.3 NA <- newest, allowed (highest of non-alternative ones)

			let skip = false;

			// Do not allow same versions

			for (let i = 0, l = alternatives.length; i < l; i++) {
				const alternative = alternatives[i];
			
				if (alternative.version !== mod.version) continue;

				skip = true;

				break;
			}

			if (skip) {
				this._log("info", `Module "${mod.name}" with version "${mod.version}" is already found ("${mod.main}")`);

				continue;
			}

			alternatives.push(mod);
		}

		let logStr = "";

		let readyCount = 0;

		for (const name in discovered) {
			let discovery = discovered[name]!;

			const nonAlternative = discovery.filter(_ => _["no-alternatives"]);

			if (nonAlternative.length > 1) {
				let highest: Interfaces.IModuleInfo = nonAlternative[0];

				for (let i = 0, l = discovery.length; i < l; i++) {
					const alternative = discovery[i];
				
					if (!alternative["no-alternatives"]) continue;

					if (semver.lte(alternative.version, highest.version)) continue;

					highest = alternative;
				}

				discovery = discovery.filter(_ => !_["no-alternatives"]);

				discovery.push(highest);
			}

			// tslint:disable-next-line: prefer-template
			logStr += "\n\t" + discovery.map(_ => {
				let entry = `${_.name}@${_.version}`;

				if (_["no-alternatives"]) entry += " *";

				return entry;
			}).join("\n\t");

			readyCount += discovery.length;

			this._infos[name] = discovery;
		}

		this._log("verb", `Ready ${readyCount} modules:${logStr}`);

		this._prototypeAll();

		this._linkAll();
	}

	// /**
	//  * Checks and updates module info
	//  * @param original Module info to update
	//  * @param updated Updated module info from discovery
	//  * @throws Throws an error if the names are different, which is a sign of invalid function usage
	//  */
	// private _checkAndUpdate(original: Interfaces.IModuleInfo, updated: Interfaces.IModuleInfo) {
	// 	if (original.name !== updated.name) {
	// 		throw new Error("The names are different and cannot be updated, the new module must be introduced");
	// 	}

	// 	original.main = updated.main;
	// 	original.version = updated.version;

	// 	for (const name in original.dependencies) {
	// 		if (!updated.dependencies[name]) {
	// 			delete original.dependencies[name];
	// 		}
	// 	}

	// 	for (const name in updated.dependencies) {
	// 		original.dependencies[name] = updated.dependencies[name];
	// 	}
	// }

	/**
	 * Makes prototypes out of dependencies
	 */
	private _prototypeAll() {
		this._log("verb", "Prototyping the modules...");

		let keepersPrototyped = 0;

		const allKeepers = this._allKeepers;
		const infoMapped = this._infoMappedKeepers;

		for (const name in this._infos) {
			if (this._keepers[name]) continue;

			const modInfos = this._infos[name]!;

			const keepers = this._keepers[name] || (this._keepers[name] = []);

			for (let i = 0, l = modInfos.length; i < l; i++) {
				const mod = modInfos[i];
			
				const modKeeper = new ModuleKeeper(mod);

				keepers.push(modKeeper);

				allKeepers.push(modKeeper);

				infoMapped.set(mod, modKeeper);
			}

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
			const modKeepers = this._getKeepers(modName);

			for (let i = 0, l = modKeepers.length; i < l; i++) {
				const modKeeper = modKeepers[i];
				const modInfo = modKeeper.info;
			
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

						this._log("info", `Optional: Module "${modName}" requested "${depName}", but it cannot be found`);

						logStr += `\n\t  - MISSING: ${depName}: not found`;

						continue;
					}

					// Dependencies version map must be built to avoid another loop iteration
					const depVerMap: IHashMap<Interfaces.IModuleInfo> = Object.create(null);

					// Mapping the versions and in the same time adding them to the depVerMap
					const depVersions = depInfo.map(_ => (depVerMap[_.version] = _, _.version));

					const satisfyingVer = semver.maxSatisfying(depVersions, verRange);

					if (!satisfyingVer) {
						if (!optional) {
							throw new Error(`Unable to satisfy requirement for "${depName}" of dependent "${modName}": ${verRange} (the only available are: ${depVersions.join()})`);
						}

						this._log("info", `Optional: Module "${modName}" requested "${depName}" but version no version in set { ${depVersions.join()} } is able to satisfy requirement of "${verRange}"`);

						logStr += `\n\t  - MISSING: ${depName}: version mismatch ("${verRange}" required)`;

						continue;
					}

					this._log("verb", `Linking "${depName}" to "${modName}": ${satisfyingVer} satisfies ${verRange}`);

					const depKeeper = this._infoMappedKeepers.get(depVerMap[satisfyingVer]);

					if (depKeeper == null) {
						throw new Error(`Invalid state: tried to get keeper whose information matches tho one that was mapped by the version ("${satisfyingVer}"), but got nothing`);
					}

					modKeeper.addDependency(depKeeper);

					logStr += `\n\t  - ${depName}@${depKeeper.info.version}`;
				}
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

		const allKeepers = this._allKeepers;

		for (let i = 0, l = allKeepers.length; i < l; i++) {
			const keeper = allKeepers[i];
		
			if (keeper.state !== Interfaces.ModuleLoadState.Prototype) {
				continue;
			}

			try {
				await keeper.construct();
			} catch (err) {
				const { name } = keeper.info;

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

		const allKeepers = this._allKeepers;

		for (let i = 0, l = allKeepers.length; i < l; i++) {
			const keeper = allKeepers[i];
		
			if (keeper.state !== Interfaces.ModuleLoadState.Constructed) {
				continue;
			}

			try {
				await keeper.initialize();
			} catch (err) {
				const { name } = keeper.info;

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

		const allKeepers = this._allKeepers;

		for (let i = 0, l = allKeepers.length; i < l; i++) {	
			const keeper = allKeepers[i];

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
	 * Searches for the keepers by given name
	 * @param name Name to look up
	 */
	public getKeepers<T>(name: string) {
		return <Array<ModuleKeeper<T>> | undefined> this._keepers[name];
	}

	/**
	 * Searches for a keeper by given name and that matches
	 * the version range specified, highest version returned
	 * @param name Name to look up
	 * @param range Version range
	 * @example
	 * $modLoader.getKeeper("my-module", ">=0.6.X")
	 * // => ModuleKeeper<"my-module", "0.6.3">
	 */
	public getKeeper<T>(name: string, range: string) {
		const keepers = this.getKeepers<T>(name);

		if (!keepers) return undefined;

		let highestSatisfying: ModuleKeeper<T> | null = null;

		for (let i = 0, l = keepers.length; i < l; i++) {
			const keeper = keepers[i];
		
			const { version } = keeper.info;

			if (!semver.satisfies(version, range)) continue;

			if (highestSatisfying != null) {
				if (semver.gt(highestSatisfying.info.version, version)) continue;
			}

			highestSatisfying = keeper;
		}

		return highestSatisfying;
	}

	/**
	 * Gets an keeper from the collection by its name or throws an error
	 * @param name Name to look up
	 * @throws Throws an error if keeper is not found
	 */
	private _getKeepers(name: string) {
		const keepers = this._keepers[name];

		if (!keepers) throw new Error(`No keepers found for "${name}"`);

		return keepers;
	}
}

// #endregion
