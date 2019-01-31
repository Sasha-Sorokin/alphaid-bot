import * as Interfaces from "@sb-types/ModuleLoader/Interfaces.new";
import { EventEmitter } from "events";
import { isClass, removeFromArray } from "@utils/extensions";
import { ModulePublicInterface } from "./PublicInterfaces";
import { ModulePrivateInterface } from "./PrivateInterface";

const CONSTRUCTION_LOCKER = new WeakSet<ModuleBase<any>>();
const INITIALIZATION_LOCKER = new WeakSet<ModuleBase<any>>();

const PENDING_STATES = new WeakMap<ModuleBase<any>, "unload" | "initialization">();

export class ModuleBase<T> extends EventEmitter {
	/**
	 * Base information about module
	 */
	public get info() {
		return this._info;
	}

	/**
	 * Loaded module
	 * Will be empty if module isn't loaded yet
	 */
	public get base() {
		return this._base;
	}

	/**
	 * Module loading state
	 */
	public get state() {
		return this._state;
	}

	/**
	 * Module dependents
	 */
	public get dependents() {
		return this._dependents;
	}

	/**
	 * Module dependencies
	 */
	public get dependencies() {
		return this._dependencies;
	}

	/**
	 * Gets public interface to use by the other modules
	 */
	public get publicInterface() {
		return this._publicInterface;
	}

	private _state: Interfaces.ModuleLoadState = Interfaces.ModuleLoadState.Prototype;
	private _base?: Interfaces.IModule<T> & T;

	private readonly _info: Interfaces.IModuleInfo;

	// if this module unloads, the dependents will be unloaded too
	private readonly _dependents: Array<ModuleBase<any>> = [];

	// if one dependency unloads, the module unloads too
	private readonly _dependencies: Array<ModuleBase<any>> = [];

	private readonly _publicInterface: ModulePublicInterface<T>;
	private readonly _privateInterface: ModulePrivateInterface<T>;

	constructor(info: Interfaces.IModuleInfo) {
		super();

		this._info = info;

		this._privateInterface = new ModulePrivateInterface(this);
		this._publicInterface = new ModulePublicInterface(this);
	}

	/**
	 * Adds a dependent module keeper
	 * @param dependent Dependent to add
	 */
	private addDependent(dependent: ModuleBase<any>) {
		this._dependents.push(dependent);

		return this;
	}

	/**
	 * Adds a dependency module keeper
	 * 
	 * That automatically adds a dependent to the dependency
	 * @param dependency Dependency to add
	 */
	public addDependency(dependency: ModuleBase<any>) {
		this._dependencies.push(dependency);

		dependency.addDependent(this);

		return this;
	}

	/**
	 * Removes a dependent module keeper
	 * @param dependent Dependent to remove
	 */
	private removeDependent(dependent: ModuleBase<any>) {
		const removedDependent = removeFromArray(this._dependents, dependent);

		if (removedDependent === undefined) {
			// TODO: Do we really need to throw an error?

			throw new Error(`Cannot find "${dependent._info.name}" as dependent of "${this._info.name}"`);
		}

		return this;
	}

	/**
	 * Removes a dependency
	 * 
	 * That automatically removes a dependent from the dependency
	 * @param dependency Dependency to remove
	 */
	public removeDependency(dependency: ModuleBase<any>) {
		const removedDependency = removeFromArray(this._dependencies, dependency);

		if (removedDependency === undefined) {
			throw new Error(`Cannot find "${dependency._info.name}" as dependency of "${this._info.name}"`);
		}

		removedDependency.removeDependent(dependency);
	}

	/**
	 * Loads a module file and constructs returned class
	 * @fires ModuleBase<T>#constructed If module has successfully constructed the event will be fired
	 * @fires ModuleBase<T>#error If module has failed to initialize an error will be thrown as well as event fired
	 * @returns Promise which'll be resolved with this module's base once module is loaded
	 */
	public async construct() {
		if (this._state !== Interfaces.ModuleLoadState.Prototype) {
			throw new Error("Module is not in prototype state to aperform construction");
		}

		if (CONSTRUCTION_LOCKER.has(this)) {
			throw new Error("Module is already constructing");
		}

		// Construct dependencies

		const dependencies = this._dependencies;

		for (let i = 0, l = dependencies.length; i < l; i++) {
			const dependency = dependencies[i];

			if (dependency.state === Interfaces.ModuleLoadState.Prototype) {
				await dependency.construct();
			} else if (dependency.state === Interfaces.ModuleLoadState.Failure) {
				throw new Error("One of the dependencies has failed to construct or initialize");
			}
		}

		// Construct mod

		this.emit(Interfaces.ModuleEvent.Construction);

		try {
			let mod = require(this._info.main);

			mod = mod[this._info.entrypoint || "default"];

			if (!isClass(mod)) {
				throw new Error("The module file has returned entrypoint of invalid type");
			}

			const base = new mod(this._privateInterface);

			if (typeof base.supplyPrivateInterface === "function") {
				base.supplyPrivateInterface(this._privateInterface);
			}

			if (typeof base.unload !== "function") {
				// TODO: see if unload function is really that necessary
				throw new Error("The module has no `unload` function");
			}

			this._base = base;
		} catch (err) {
			this.emit("error", {
				state: "construct",
				error: err
			});
			
			this._state = Interfaces.ModuleLoadState.Failure;
			
			throw err;
		}

		this._state = Interfaces.ModuleLoadState.Constructed;

		CONSTRUCTION_LOCKER.delete(this);

		this.emit(Interfaces.ModuleEvent.Constructed, this._base);

		return this;
	}

	/**
	 * Initializes the constructed module
	 * @fires ModuleBase<T>#initialization If dependencies have initialized without errors the event will be fired
	 * @fires ModuleBase<T>#initialized If module has initialized without errors the event will be fired
	 */
	public async initialize() {
		if (this._state !== Interfaces.ModuleLoadState.Constructed) {
			throw new Error("Module is not in constucted state to aperform initialization");
		}

		if (INITIALIZATION_LOCKER.has(this)) {
			throw new Error("This module is already initializing");
		}

		INITIALIZATION_LOCKER.add(this);

		const dependencies = this._dependencies;

		for (let i = 0, l = dependencies.length; i < l; i++) {
			const dependency = dependencies[i];

			if (dependency.state === Interfaces.ModuleLoadState.Prototype) {
				await dependency.construct(); // should we throw an error instead?
			}

			if (dependency.state === Interfaces.ModuleLoadState.Constructed) {
				await dependency.initialize();
			} else if (dependency.state === Interfaces.ModuleLoadState.Failure) {
				throw new Error("One of the dependencies has failed to construct or initialize");
			}
		}

		this.emit(Interfaces.ModuleEvent.Initialization);

		PENDING_STATES.set(this, "initialization");

		try {
			if (this._base && this._base.init) {
				await this._base.init(this._privateInterface);
			}
		} catch (err) {
			this.emit("error", {
				state: "construct",
				error: err
			});

			throw err;
		}

		this._state = Interfaces.ModuleLoadState.Initialized;

		INITIALIZATION_LOCKER.delete(this);
		PENDING_STATES.delete(this);

		this.emit(Interfaces.ModuleEvent.Initialized, this._base);

		return this;
	}

	/**
	 * Function to unload or complete destroy module if it has no unload method.
	 * @param reason Reason of unloading which'll be transmitted to module. By default "unload"
	 * @param unloadDependents Perform unloading of dependents for their own safety
	 * @fires ModuleBase<T>#unloading
	 * @fires ModuleBase<T>#error
	 * @fires ModuleBase<T>#destroyed
	 * @fires ModuleBase<T>#unloaded
	 * @returns Promise which'll be resolved with this module's base once module is unloaded or destroyed
	 */
	public async unload(reason: any = "unload", unloadDependents = true) {
		if (
			this._state !== Interfaces.ModuleLoadState.Initialized &&
			this._state !== Interfaces.ModuleLoadState.Constructed
		) {
			throw new Error("Module is not loaded");
		}

		if (unloadDependents) {

			for (let i = 0, l = this._dependents.length; i < l; i++) {
				const dependent = this._dependents[i];
				
				dependent.unload("dependent_");
			}

		}

		this.emit("unloading", this._base);

		PENDING_STATES.set(this, "unload");

		if (!this._base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable is `undefined`")
			});

			this._state = Interfaces.ModuleLoadState.Unloaded;
		} else {
			try {
				const unloaded = await this._base.unload(this._privateInterface, reason);
				if (unloaded) {
					this._base = undefined;
					this._state = Interfaces.ModuleLoadState.Unloaded;
				} else {
					throw new Error("Returned `false`: that means module has troubles with unloading");
				}
			} catch (err) {
				this.emit("error", {
					state: "unload#unload",
					error: err
				});
			}
		}

		PENDING_STATES.delete(this);

		this.emit("unloaded");

		return this;
	}


	/**
	 * Clears require cache for this module.
	 * 
	 * Useful while reloading module: in this case module file will be read from disk
	 * @returns This keeper
	 */
	public clearRequireCache() {
		if (require.cache[this._info.main]) {
			delete require.cache[this._info.main];
		}

		return this;
	}

	/**
	 * Gets current pending state
	 * @returns Either `"unload"` if module is pending unload
	 * or `"initialization"` if module is pending initialization
	 */
	public getPendingState() {
		return PENDING_STATES.get(this);
	}

	/**
	 * Shortcut for checking if module is already initialized or you need to wait for it.
	 * 
	 * If module is already initialized, then immediately calls the callback.
	 * Otherwise subscribes you to the `initialized` event
	 * @param callback The callback function that will be called with base
	 * @listens ModuleBase<T>#initialized
	 */
	public onInit(callback: (base: T) => void) {
		if (this._state === Interfaces.ModuleLoadState.Initialized && this._base) {
			callback(this._base);

			return this;
		}

		return this.once("initialized", callback);
	}

	/**
	 * Shortcut for checking if module is already loaded or you need to wait for it.
	 * 
	 * If module is already loaded, then immediately calls the callback.
	 * Otehrwise subscribes you to the `loaded` event
	 * @param callback The callback function that will be called with `base`
	 * @listens ModuleBase<T>#constructed
	 */
	public onConstruct(callback: (base: T) => void) {
		if (this._state === Interfaces.ModuleLoadState.Constructed && this._base) {
			callback(this._base);

			return this;
		}

		return this.once("constructed", callback);
	}
}
