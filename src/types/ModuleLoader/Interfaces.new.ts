import { INullableHashMap } from "@sb-types/Types";
import { ModulePrivateInterface } from "./PrivateInterface";

export type ModuleBase<T> = T & IModule<T>;

export interface IModule<T> {
	/**
	 * An optional async method of the initialization
	 * 
	 * Without this method module immediately phases into initialized state
	 * @param i Private interface to interact with module keeper
	 */
	init?(i: ModulePrivateInterface<T>): Promise<void>;
	/**
	 * An optional method called right after the construction of the module
	 * 
	 * Supplies with private interface to interact with other modules
	 * 
	 * The private interface will be also supplied within the initialization and unload states
	 * @param i Private interface to interact with module keeper
	 */
	supplyPrivateInterface?(i: ModulePrivateInterface<T>): void;
	/**
	 * A function that called to unload the modules to perform cleanup
	 * @param reason Reason that caused module to unload
	 * @param i Private interface to interact with module keeper
	 */
	unload(i: ModulePrivateInterface<T>, reason: string): Promise<boolean>;
}

export interface IModuleInfo {
	/**
	 * Name of module
	 */
	name: string;
	/**
	 * Module version
	 */
	version: string;
	/**
	 * Path to module
	 */
	main: string;
	/**
	 * Entry point to execute
	 * 
	 * `default` by default
	 */
	entrypoint?: string;
	/**
	 * Names of the dependencies
	 */
	dependencies: INullableHashMap<string>;
}


/**
 * Returns a state of module initialization
 */
export const enum ModuleLoadState {
	/**
	 * Module Keeper is ready to load the module
	 */
	Prototype = "prototyped",
	/**
	 * Module is constructed and ready to be initialized
	 */
	Constructed = "constructed",
	/**
	 * Module in progress of initialization
	 */
	Initializing = "initializing",
	/**
	 * Module is initializated and working
	 */
	Initialized = "initialized",
	/**
	 * Module was unloaded
	 */
	Unloaded = "unloaded",
	/**
	 * Module has failed to construct or initialize
	 */
	Failure = "error"
}

export const enum ModuleEvent {
	/**
	 * A contruction has just begun
	 */
	Construction = "construction",
	/**
	 * The module has been constructed
	 *
	 * The following argument is the module base
	 */
	Constructed = "constructed",
	/**
	 * Initialization has just begun
	 * 
	 * All dependencies are now initialized
	 */
	Initialization = "initialization",
	/**
	 * The module has been initialized without errors
	 * 
	 * The following argument is the module base
	 */
	Initialized = "initialized",
	/**
	 * The module is about to unload
	 * 
	 * The following argument is the module base
	 */
	Unloading = "unloading",
	/**
	 * The module has been unloaded
	 */
	Unloaded = "unloaded",
	/**
	 * The subroutine has caused an error
	 * 
	 * The following argument is the details about error
	 */
	Failure = "error"
}
