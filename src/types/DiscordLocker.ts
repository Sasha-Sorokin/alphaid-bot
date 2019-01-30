import { INullableHashMap } from "@sb-types/Types";
import { Guild, TextChannel, DMChannel, GroupDMChannel } from "discord.js";
import { EventEmitter } from "events";
import { isPromise } from "@utils/extensions";

type PossibleTargets = string | Guild | TextChannel | DMChannel | GroupDMChannel;
type EmptyVoid = () => void;

/**
 * # Discord Locker
 * 
 * Creates special class to lock and unlock some target.
 * 
 * ## Features:
 * 
 * - Can lock and unlock of course! 👌
 * - Calls any callback using process.nextTick (is this even a feature?)
 * - Has lock function that returns Promise that resolves with result of onLock function
 * - Has function to await for unlock and alias function to create Promise for this function
 * 
 * ## To note
 * 
 * Use semaphore if you could do changes at the same time or want to build queues.
 */
export class DiscordLocker {
	private readonly _lockStates: INullableHashMap<boolean>;
	private readonly _dispatcher: EventEmitter;

	/**
	 * __Creates new locker__.
	 * Use it where changing of some resource at the same time is impossible
	 */
	constructor() {
		this._lockStates = Object.create(null);
		this._dispatcher = new EventEmitter();
	}

	/**
	 * Checks lock state of resource for selected target
	 * @param targetId Target of where to check resource lock state
	 */
	public isLocked(targetId: PossibleTargets) {
		targetId = this._normalizeTarget(targetId);

		return this._lockStates[targetId] || false;
	}

	/**
	 * Locks resource for selected target
	 * @param targetId Target of where resource lock happens
	 * @param onLock Callback function if lock happened
	 * @param lockFailed Callback function if lock failed
	 * @returns `true` if lock happened, otherwise `false`
	 */
	public lock(targetId: PossibleTargets, onLock: (unlock: EmptyVoid) => void, lockFailed?: EmptyVoid) {
		targetId = this._normalizeTarget(targetId);
		if (this._lockStates[targetId]) {
			lockFailed && process.nextTick(lockFailed);

			return false;
		}
		this._lockStates[targetId] = true;
		process.nextTick(() => onLock(this._createSingletimeUnlocker(<string> targetId)));

		return true;
	}

	/**
	 * __Locks resource and returns promise__, which resolves once onLock function is executed
	 * @param targetId Target of where resource lock happens
	 * @param onLock Callback function if lock happened
	 * @param lockFailed Callback function if lock failed
	 * @returns Promise, which resolves with result of onLock function once unlock happens and rejects if lock failed
	 */
	public lockAwait<T = void>(targetId: PossibleTargets, onLock: () => T, lockFailed?: EmptyVoid) : Promise<T> {
		targetId = this._normalizeTarget(targetId);

		return new Promise((res, rej) => {
			const isLocked = this.lock(targetId, async (unlock) => {
				let onLockResult = onLock();
				isPromise<T>(onLockResult) && (onLockResult = await onLockResult);
				res(onLockResult);
				unlock();
			}, lockFailed);

			if (isLocked) { return; }
			// `lock` always returns `false` if already locked

			return rej({
				code: "LOCK_IN_EFFECT",
				message: "The lock is already in effect"
			});
		});
	}

	/**
	 * Waits till resource is unlocked and then calls special function (aka callback)
	 * @param targetId Target of where lock happened
	 * @param onUnlock Callback function if resource is not locked or was unlocked
	 * @param args Arguments to pass to callback function
	 */
	public waitForUnlock<T>(targetId: PossibleTargets, onUnlock: (...args: T[]) => void, ...args: T[]) {
		targetId = this._normalizeTarget(targetId);
		if (!this._lockStates[targetId]) { return process.nextTick(onUnlock, ...args); }
		this._dispatcher.once(`${targetId}:unlock`, () => process.nextTick(onUnlock, ...args));
	}

	/**
	 * __Creates Promise, which resolves when resource is unlocked__.
	 * Use `waitForUnlock` instead if you don't need Promise
	 * @param targetId Target of where lock happened
	 * @param value Value to resolve Promise with
	 * @returns Promise, which resolves when resource is unlocked
	 */
	public awaitForUnlock<T>(targetId: PossibleTargets, value?: T) {
		return new Promise((res) => this.waitForUnlock(targetId, res, value));
	}

	/**
	 * Unlocks resource for selected target
	 * @param targetId Target of where lock in effect
	 * @returns `true` if unlock happened, otherwise `false`
	 */
	public unlock(targetId: PossibleTargets) {
		targetId = this._normalizeTarget(targetId);
		if (!this._lockStates[targetId]) { return false; }
		this._lockStates[targetId] = false;
		this._dispatcher.emit(`${targetId}:unlock`);

		return true;
	}

	private _createSingletimeUnlocker(targetId: string) {
		let isUsed = false;

		return () => {
			if (isUsed) { throw new Error("This target is already unlocked"); }

			return (isUsed = true) && this.unlock(targetId);
		};
	}

	private _normalizeTarget(target: PossibleTargets) {
		if (typeof target === "string") { return target; }
		if (target instanceof Guild) { return `g[${target.id}]`; }

		return `${target.type}[${target.id}]`;
	}
}
