import { IModuleInfo } from "../Interfaces.new";
import * as path from "path";
import * as YAML from "js-yaml";
import * as getLogger from "loggy";
import * as discoveryUtils from "./ModuleDiscoveryUtils";
import * as semver from "semver";

const LOG = getLogger("ModuleDiscovery");

/**
 * Directory routing
 * @ignore
 */
export interface IRouting {
	/**
	 * Pathes to modules in current directory
	 */
	path: string[];
}

/**
 * Searches the modules within the directory
 * @param directory Directory to look up for modules
 * @returns Discovered modules within the subdirectories of directory
 * @ignore
 */
export async function build(directory: string) {
	const subdirectories = await discoveryUtils.subdirectories(directory);

	return discover(subdirectories);
}

/**
 * Discovers modules and directories
 * @param directories Directories to look up for modules and routes
 * @returns Discovered modules within provided directories
 */
async function discover(directories: string[]) {
	const discovery: IModuleInfo[] = [];

	for (let i = 0, l = directories.length; i < l; i++) {
		const directory = directories[i];
		let sucessfullDiscovery = false;

		LOG("info", `Discovery: Discovering directory: "${directory}"`);

		{ // Attempt to discover a module
			const module = await moduleInDirectory(directory);

			if (module != null) {
				LOG("info", `Discovery: Module discovered in: "${directory}"`);

				discovery.push(module);

				sucessfullDiscovery = true;
			}
		}

		try { // Attempt to discover a routing
			const routing = await routingInDirectory(directory);

			if (routing != null) {
				LOG("info", `Discovery: Routing discovered in: "${directory}"`);

				const routedDiscovery = await discover(routing.path);

				for (let i = 0, l = routedDiscovery.length; i < l; i++) {
					discovery.push(routedDiscovery[i]);
				}

				sucessfullDiscovery = true;
			}
		} catch (err) {
			LOG("err", `Discovery: Discovery of the routing within the directory "${directory}" failed`, err);
		}

		if (!sucessfullDiscovery) LOG("info", `Discovery: Discovered empty directory: "${directory}"`);
	}

	return discovery;
}

/**
 * Lookups for module in the directory
 * @param directory Directory to look up for module
 * @returns Module within the directory or `undefined`
 */
async function moduleInDirectory(directory: string) {
	const content = await discoveryUtils.safeRead(path.join(directory, "mod.yml"));

	if (content == null) return undefined;

	try {
		const moduleInfo = <IModuleInfo> YAML.safeLoad(content);

		const normalizedPath = discoveryUtils.normalizeFileName(moduleInfo.main, directory);

		discoveryUtils.pathPrecaution(normalizedPath, directory);

		moduleInfo.main = normalizedPath;

		const parsedVersion = semver.valid(moduleInfo.version);

		if (!parsedVersion) {
			throw new Error(`Invalid version - ${moduleInfo.version}`);
		}

		moduleInfo.version = parsedVersion;

		return moduleInfo;
	} catch (err) {
		LOG("warn", "Module Search: Cannot read module information", err);

		return undefined;
	}
}

/**
 * Lookups for route in the directory
 * @param directory Directory to look up for route
 * @throws Throws an error if one of the pathes does not belong to the directory
 * @returns Routing within the directory or `undefined`
 */
async function routingInDirectory(directory: string) {
	const content = await discoveryUtils.safeRead(path.join(directory, "routes.yml"));

	if (content == null) return undefined;

	const routing = await discoveryUtils.safeLoadYAML<IRouting>(content);

	if (routing != null) {
		for (let i = 0, l = routing.path.length; i < l; i++) {
			const directoryPath = routing.path[i];

			const normalizedPath = discoveryUtils.normalizeFileName(directoryPath, directory);

			discoveryUtils.pathPrecaution(normalizedPath, directory);

			routing.path[i] = normalizedPath;
		}
	}

	return routing;
}
