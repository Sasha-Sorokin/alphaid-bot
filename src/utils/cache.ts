import { getRedisClient } from "@utils/redis";

/**
 * Default time to life for cache
 * @ignore
 */
const DEFAULT_TTL = 30 * 60; // 30 min?

/**
 * Allowed cache types
 * @ignore
 */
type AllowedTypes = string | number | object;

/**
 * Results of cache push
 */
interface IPushResults<T> {
	/**
	 * Returned value by redis
	 */
	value: T;
	/**
	 * Whether was it pushed as array to the Redis or not
	 */
	isArray: boolean;
	/**
	 * Whether `JSON.stringify` was called at least once to store the value
	 */
	stringifyTriggered: boolean;
	/**
	 * If array has contained the objects, the indexes for which the `JSON.stringify`
	 * was called. If never triggered, returns `undefined`
	 */
	stringifyTriggeredAt?: number[];
	/**
	 * Sanitized storage key
	 * @see storeValue For the details about how key is sanitized, look at `storeValue` docs
	 */
	builtKey: string;
}

/**
 * Stores value for some time by special key.
 * 
 * Special key is generated based on owner and key. By default many characters
 * are stripped out of the owner and key names, this can result an empty string
 * (if that happens, an error will be thrown), the allowed key characters are:
 * - Latin and Russian letters (A-Z; А-Я; case-insensetive)
 * - Numbers (0-9)
 * - `-`, `_`, `.`, `:` and space
 * @param owner Cache owner identifier
 * @param key Key which will be used next to the owner, the owner can have multiple values store
 * @param value Value to store in the database. For JS objects `JSON.stringify` is used
 * @param ttl How much time cache will live in the Redis memory before deleted
 * @returns Result of pushing to the cache storage
 */
export async function storeValue<T>(owner: string, key: string, value: AllowedTypes | AllowedTypes[], ttl = DEFAULT_TTL): Promise<IPushResults<T>> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);

	if (Array.isArray(value)) {
		const stringifyTriggeredAt: number[] = [];

		let pipeline = redisClient.pipeline();
		// tbh I still unsure if I need to reassign pipeline var
		// if nope, pls report an issue or make merge request
		// thanx <3
		for (let i = 0; i < value.length; i++) {
			let val = value[i];

			if (typeof val === "object") {
				val = JSON.stringify(val);
				stringifyTriggeredAt.push(i);
			}

			pipeline = pipeline.rpush(builtKey, val);
		}

		pipeline.expire(builtKey, ttl);

		const stringifyCalled = stringifyTriggeredAt.length > 0;

		return {
			builtKey,
			isArray: true,
			value: await redisClient.lrange(builtKey, 0, -1),
			stringifyTriggered: stringifyCalled,
			stringifyTriggeredAt: stringifyCalled ? stringifyTriggeredAt : undefined
		};
	} else {
		let stringifyCalled = false;

		if (typeof value === "object") {
			stringifyCalled = true;
			value = JSON.stringify(value);
		}

		return {
			builtKey,
			isArray: false,
			stringifyTriggered: stringifyCalled,
			value: await redisClient.pipeline().set(builtKey, value, "EX", ttl).get(builtKey).exec()
		};
	}
}

/**
 * Gets get
 * @param owner Cache owner identifier
 * @param key Key under what value was stored
 * @param isJson Whether should be returned value parsed as JSON or not
 * @param pop Remove the value from the cache storage after obtained
 */
export async function get<T>(owner: string, key: string, isJson = false, pop = false): Promise<T | null> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);
	const res = await redisClient.get(builtKey);
	if (pop) { await redisClient.del(builtKey); }

	return isJson && res != null ? JSON.parse(res) : res;
}

/**
 * Gets a list from the Redis storage
 * @param owner Cache owner identifier
 * @param key Key under what value was stored
 * @param jsonParse Whether to parse elements of array as JSON or not
 * @param pop Whether must be value immediately deleted from the storage or net
 * @returns An array of elements stored under the key
 */
export async function getArray<T>(owner: string, key: string, jsonParse: boolean | number[] = false, pop = false): Promise<T> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);
	let res = await redisClient.lrange(builtKey, 0, -1);

	if (jsonParse != null) {
		if (Array.isArray(jsonParse)) {
			res = parseByIndexes<T>(res, jsonParse);
		} else {
			res = parseArrayElements<T>(res);
		}
	}

	if (pop) { await redisClient.del(builtKey); }

	return <T> <unknown> res;
}

/**
 * Deletes specified keys from the Redis storage
 * @param owner Cache owner identifier
 * @param keys Keys to delete from the Redis storage
 * @returns Number of keys that were removed
 */
export async function deleteKeys(owner: string, keys: string | string[]) {
	const redisClient = await getRedisClient();

	if (Array.isArray(keys)) {
		for (let i = 0; i < keys.length; i++) {
			keys[i] = buildCacheKey(owner, keys[i]);
		}
	} else {
		keys = [buildCacheKey(owner, keys)];
	}

	return redisClient.del(...keys);
}

/**
 * Parses JSON elements under the specified indexes
 * @param arr Array of elements
 * @param parseIndexes Indexes under what to parse JSON
 * @ignore
 */
function parseByIndexes<T>(arr: Array<unknown>, parseIndexes: number[]) : T {
	for (let i = 0, l = parseIndexes.length; i < l; i++) {
		const index = parseIndexes[i];

		const elem = arr[index];

		if (typeof elem !== "string") {
			throw new Error(`Element under the index ${index} is not string type`);
		}

		arr[index] = JSON.parse(elem);
	}

	return <T> <unknown> arr;
}

/**
 * Parses every alement of array as JSON
 * @param arr Array of elements to parse
 * @ignore
 */
function parseArrayElements<T>(arr: Array<unknown>) {
	for (let i = 0, l = arr.length; i < l; i++) {
		const elem = arr[i];

		if (typeof elem !== "string") {
			throw new Error(`Element under the index ${i} is not string type`);
		}

		arr[i] = JSON.parse(elem);
	}

	return <T> <unknown> arr;
}

/**
 * Strips all unknown characters to make clear Redis keys
 * @param str String to strip from unknown characters
 * @ignore
 */
function stripUnnecessaryChars(str: string) {
	return str.replace(/[^A-ZА-Я0-9\-\.\_\ \:]/ig, "").trim();
}

/**
 * Checks if the provided key is zero in lenght
 * @param role Role that this key plays
 * @param key Key to check for length
 * @throws Throws an error if key has zero length
 * @ignore
 */
function lengthCheck(role: string, key: string) {
	if (key.length < 1) {
		throw new Error(`Invalid-Length \`${role}\` provided: '${key}'`);
	}

	return key;
}

/**
 * Creates a key based on owner and key itself to store in Redis
 * @param owner Owner of the key
 * @param key Key to add
 * @ignore
 */
function buildCacheKey(owner: string, key: string) {
	owner = lengthCheck("owner", stripUnnecessaryChars(owner));
	key = lengthCheck("key", stripUnnecessaryChars(key));

	return `abot_cache:${owner}[${key}]`;
}
