import { IModule, ModuleLoaderEvent } from "@sb-types/ModuleLoader/Interfaces.new";
import { initializationMethod, unloadMethod } from "@sb-types/ModuleLoader/Decorators";
import * as getLogger from "loggy";

const HANDLER = Symbol("handler");
const LOG = Symbol("logger");

export class Cleaner implements IModule<Cleaner> {
	private [HANDLER]: () => void;
	private [LOG] = getLogger("Cleaner");

	@initializationMethod
	public async init() {
		const handler = () => this._clean();

		$modLoader.on(ModuleLoaderEvent.PostInitialization, handler);

		this[HANDLER] = handler;

		this[LOG]("info", "Init: Cleaner module is enabled. Some modules may misbehave due to not following the specification");
	}

	private _clean() {
		this[LOG]("info", "PostInitialization: Cleaning the resources...");

		this._cleanLocales();

		// TODO: see what can be cleaned
	}

	/**
	 * Cleans locales from unassigned keys
	 */
	private _cleanLocales() {
		const log = this[LOG];

		const sourceLanguage = $localizer.sourceLanguage;

		const keys = $localizer.getLanguageKeys(sourceLanguage);

		if (!keys) throw new Error("Invalid state: source map is not returned");

		const toPrune: string[] = [];

		const assignation = $localizer.keysAssignation;

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = keys[i];

			if (assignation.isAssigned(key)) continue;

			toPrune.push(key);

			log("info", `PostInitialization: (locales) "${key}" to be pruned, not assigned to any owner`);
		}

		const unassignedKeys = $localizer.pruneLanguages(toPrune);

		log("ok", `PostInitialization: (locales) ${unassignedKeys.length} keys were cleaned`);
	}

	@unloadMethod
	public async unload() {
		const handler = this[HANDLER];

		if (handler) {
			$modLoader.removeListener(ModuleLoaderEvent.PostInitialization, handler);
		}

		return true;
	}
}

export default Cleaner;
