import { ModuleKeeper } from "./ModuleKeeper.new";
import { ModuleLoadState, ModuleBase } from "./Interfaces.new";

const KEEPER_REFERENCES = new WeakMap<ModulePublicInterface<any>, ModuleKeeper<any>>();

/**
 * Public interface to interact with module keeper
 */
export class ModulePublicInterface<T> {
	constructor(base: ModuleKeeper<T>) {
		KEEPER_REFERENCES.set(this, base);
	}

	/**
	 * Gets name of the module
	 */
	public getName() {
		return KEEPER_REFERENCES.get(this)!.info.name;
	}

	/**
	 * Gets base class of the module
	 */
	public getBase() : ModuleBase<T> | undefined {
		return KEEPER_REFERENCES.get(this)!.base;
	}

	/**
	 * Gets state of the module
	 */
	public getState() : ModuleLoadState {
		return KEEPER_REFERENCES.get(this)!.state;
	}

	/**
	 * Shortcut for checking if module is already initialized or you need to wait for it.
	 * 
	 * If module is already initialized, then immediately calls the callback. Otherwise subscribes you to the initialized event
	 * @param callback Callback function that will be called when module is initialized
	 */
	public onInit(callback: (base: ModuleBase<T>) => void) {
		return KEEPER_REFERENCES.get(this)!.onInit(callback);
	}

	public onConstruct(callback: (base: ModuleBase<T>) => void) {
		return KEEPER_REFERENCES.get(this)!.onConstruct(callback);
	}
}
