# Alphaid Module Loader

## Module Class File

```ts
import { IModule } from "@sb-types/ModuleLoader/Interfaces.new";
import { ModulePrivateInterface } from "@sb-types/ModuleLoader/PrivateInterface";
import { initializationMethod, unloadMethod } from "@sb-types/ModuleLoader/Decorators";

export class Module implements IModule<Module> {
	constructor() {
		throw new Error("Method not implemented.");
	}

	public supplyPrivateInterface(i: ModulePrivateInterface<Module>) {
		throw new Error("Method not implemented.");
	}

	@initializationMethod
	public async init(i: ModulePrivateInterface<Module>) {
		throw new Error("Method not implemented.");
	}

	@unloadMethod
	public async unload(i: ModulePrivateInterface<Module>, reason: string): Promise<boolean> {
		throw new Error("Method not implemented.");
	}
}

export default Module;

```

### Is JavaScript class

Module class file must be a valid JavaScript class, not a function.

- [Read more about JavaScript classes →](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes)

### Can extend other classes

There are no limitations about extending other classes as long as you following this specification.

### Implements `IModule<T>`

All module class files must implement `IModule<T>` interface (where `T` is the module class itself) with the following functions:

#### `supplyPrivateInterface(i: ModulePrivateInterface<T>)` ⇒ `void`

Function to call immediately after the class is constructed to supply with a private module interface.

- `baseCheck` method of the `ModulePrivateInterface<T>` must be called before any operations
- Should be used to obtain data about dependencies and dependents
- Do not write synchronous code inside the function (e.g. read configs), `init` method must be used

#### **`async`** `init(i: ModulePrivateInterface<T>)` ⇒ `void`

Function to call whenever module needs to be initialized.

- `baseCheck` and `isPendingInitialization` method must be called before any operations (alternatively, `@initializationMethod` decorator can be used to wrap function)
- Should be used to finally prepare the module: read configuration files, subscribe to events
- Dependencies are initializated on this step, and dependents are awaiting the module initialization
- If anything goes wrong, an error must be thrown

#### **`async`** `unload(i: ModulePrivateInterface<T>)` ⇒ `Promise<boolean>`

Function to call whenever module needs to be unloaded.

- `baseCheck` and `isPendingUnload` method must be called before any operations (alternatively, `@unloadMethod` decorator can be used to wrap function)
- The method must be used to remove any handlers left. Do not write files or perform any long-running operations
- There are no cancellation and module must deinitialize right after the function is called
- If anything goes wrong, an error must be thrown or `false` returned
- Dependencies are initialized on this step, and dependents are unloaded
- After successful unload, `true` must be returned
