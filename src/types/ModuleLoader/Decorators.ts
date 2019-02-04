import { ModuleBase } from "./Interfaces.new";
import { ErrorMessages } from "@sb-types/Consts";
import { ModulePrivateInterface } from "./PrivateInterface";

type InitializationFunction<T> = (i?: ModulePrivateInterface<T>) => Promise<void>;

export function initializationMethod<T>(_target: ModuleBase<T>, _key: string, descriptor: TypedPropertyDescriptor<InitializationFunction<T>>) {
	const originalFunc = descriptor.value;

	if (!originalFunc) { return descriptor; }

	descriptor.value = function (this: ModuleBase<T>, i: ModulePrivateInterface<T>) {
		if (i.baseCheck(this) && !i.isPendingInitialization()) {
			throw new Error(ErrorMessages.NOT_PENDING_INITIALIZATION);
		}

		return originalFunc.apply(this, arguments);
	};

	return descriptor;
}

type UnloadFunction<T> = (i?: ModulePrivateInterface<T>, reason?: string) => Promise<boolean>;

export function unloadMethod<T>(_target: ModuleBase<T>, _key: string, descriptor: TypedPropertyDescriptor<UnloadFunction<T>>) {
	const originalFunc = descriptor.value;

	if (!originalFunc) return descriptor;

	descriptor.value = function (this: ModuleBase<T>, i: ModulePrivateInterface<T>) {
		if (i.baseCheck(this) && !i.isPendingUnload()) {
			throw new Error(ErrorMessages.NOT_PENDING_UNLOAD);
		}

		return originalFunc.apply(this, arguments);
	};

	return descriptor;
}
