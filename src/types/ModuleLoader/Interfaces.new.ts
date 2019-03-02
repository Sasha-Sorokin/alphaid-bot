import { INullableHashMap } from "@sb-types/Types";
import { ModulePrivateInterface } from "./PrivateInterface";

export type ModuleBase<T> = T & IModule<T>;

/**
 * Basic interface for all the ModuleLoader modules
 */
export interface IModule<T> {
	/**
	 * An optional async method of the initialization
	 * 
	 * Without this method module immediately phases into initialized state
	 * @param i Private interface to interact with module keeper
	 * @throws Throws an error if module is not pending initialization
	 * @throws Throws an error if module has failed to initalize
	 */
	init?(i: ModulePrivateInterface<T>): Promise<void>;
	/**
	 * An optional method called right after the construction of the module
	 * 
	 * Supplies with private interface to interact with other modules
	 * 
	 * The private interface will be also supplied within the initialization and unload states
	 * @param i Private interface to interact with module keeper
	 * @throws Throws an error if module has failed to construct
	 */
	supplyPrivateInterface?(i: ModulePrivateInterface<T>): void;
	/**
	 * A function that called to unload the modules to perform cleanup
	 * @param reason Reason that caused module to unload
	 * @param i Private interface to interact with module keeper
	 * @returns Status of unloading
	 * @throws Throws an error if module is not pending unload
	 * @throws Throws an error if module has failed to unload
	 * @todo Revise the requirement of boolean return
	 */
	unload(i: ModulePrivateInterface<T>, reason: string): Promise<boolean>;
}

/**
 * Initial information about the module to load
 */
export interface IModuleInfo {
	/**
	 * Name of module
	 */
	name: string;
	/**
	 * Whether package is node module or not
	 * 
	 * This property is defined automatically and must not be declared
	 * manually (an warning in console will be printed if this happens,
	 * and the variable is reset to the default value)
	 */
	nodeModule: boolean;
	/**
	 * Module version
	 * 
	 * Node modules can declare this via `version` in package.json
	 */
	version: string;
	/**
	 * Path to module
	 * 
	 * Node modules can declare this via `main` in package.json
	 */
	main: string;
	/**
	 * Entry point to execute
	 * 
	 * `default` by default
	 */
	entrypoint?: string;
	/**
	 * All dependencies and their version
	 * 
	 * Optional dependencies version contain `?` at the end
	 */
	dependencies: INullableHashMap<string>;
	/**
	 * Whether only one instance of the module with this name allowed
	 * 
	 * Warning: this only applies to the modules that define the same statement
	 * 
	 * Defaults to `true`
	 */
	"no-alternatives": boolean;
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

export const enum ModuleLoaderEvent {
	/**
	 * Before construction started
	 */
	BeforeConstruction = "beforeConstruction",
	/**
	 * After construction finished
	 */
	PostConstruction = "postContruction",
	/**
	 * Before initialization started
	 */
	BeforeInitialization = "beforeInitialization",
	/**
	 * After initialization finished
	 */
	PostInitialization = "postInitialization",
	/**
	 * Before unloading starts
	 */
	BeforeUnload = "beforeUnload",
	/**
	 * After unloading finished
	 */
	PostUnload = "unloaded"
}
