import { IModuleInfo } from "../Interfaces.new";
import * as path from "path";
import * as YAML from "js-yaml";
import * as getLogger from "loggy";
import * as discoveryUtils from "./ModuleDiscoveryUtils";
import * as semver from "semver";

const LOG = getLogger("ModuleDiscovery");

const NODE_MODULES_PATH = path.join(process.cwd(), "node_modules");

const SCOPED = /^@[a-z]+\/.+$/;

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
 */
export async function build(directory: string) {
	const subdirectories = await discoveryUtils.subdirectories(directory);

	return discover(subdirectories);
}

/**
 * Searches the modules within the root `node_modules` directory
 * @param prefix Prefix for the directory name to match
 * @returns Discovered modules within the subdirectories of `node_module` directory
 */
export async function buildNodeModules(prefix: string) {
	const subdirectories = await findNodeModules(undefined, prefix);

	return discover(subdirectories);
}

/**
 * Searches the node_modules directories that match specified prefix
 * @param directory Modules directory to search in
 * @param prefix Prefix to match a directory
 * @returs Array of the directories that match the prefix
 */
async function findNodeModules(directory = NODE_MODULES_PATH, prefix: string) {
	const baseSubdirectories = await discoveryUtils.subdirectories(directory);

	const matchedSubdirectories: string[] = [];

	for (let i = 0, l = baseSubdirectories.length; i < l; i++) {
		const subdirectory = baseSubdirectories[i];

		const dirName = path.basename(subdirectory);

		if (SCOPED.test(dirName)) {
			matchedSubdirectories.push(
				...(await findNodeModules(subdirectory, prefix))
			);

			continue;
		}

		
		if (!dirName.startsWith(prefix)) continue;

		LOG("info", `Node Modules: Checking "${subdirectory}"`);

		const nodeModulesInside = await discoveryUtils.exists(
			path.join(subdirectory, "node_modules"),
			_ => _.isDirectory()
		);

		if (nodeModulesInside) {
			// discover them too!

			matchedSubdirectories.push(
				...(await findNodeModules(nodeModulesInside, prefix))
			);
		}

		matchedSubdirectories.push(subdirectory);
	}

	return matchedSubdirectories;
}

/**
 * Discovers modules and directories
 * @param directories Directories to look up for modules and routes
 * @returns Discovered modules within provided directories
 * @ignore
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
 * @ignore
 */
async function moduleInDirectory(directory: string) {
	const declarationFile = path.join(directory, "mod.yml");

	const content = await discoveryUtils.safeRead(declarationFile);

	if (content == null) return undefined;

	try {
		const moduleInfo = <IModuleInfo> YAML.safeLoad(content);
		
		if (moduleInfo.name == null) {
			throw new Error(`Module name must be provided. File: ${declarationFile}`);
		}

		if (moduleInfo.nodeModule != null) {
			LOG("warn", `Module Search: Modules must not declare "nodeModule" property (in "${moduleInfo.name}")`);
		}

		moduleInfo.nodeModule = directory.startsWith(NODE_MODULES_PATH);

		if (moduleInfo.nodeModule) {
			const packageFile = await discoveryUtils.safeRead(path.join(directory, "package.json"));

			if (packageFile == null) {
				throw new Error(`Modules that are node modules must have "package.json" file (in "${moduleInfo.name}")`);
			}

			const packageInfo = JSON.parse(packageFile);

			if (moduleInfo.version == null) {
				moduleInfo.version = packageInfo.version;

				if (moduleInfo.version == null) {
					throw new Error(`Modules that are node modules must have version declared in either "mod.yml" file or "package.json" (in "${moduleInfo.name}")`);
				}
			}

			if (moduleInfo.main == null) {
				moduleInfo.main = packageInfo.main;

				if (moduleInfo.main == null) {
					throw new Error(`Modules that are node modules must have main file declared in either "mod.yml" file or "package.json" (in "${moduleInfo.name}")`);
				}
			}
		}

		// Parse and check the version:
		const parsedVersion = semver.valid(moduleInfo.version);
		
		if (!parsedVersion) {
			throw new Error(`Invalid version - ${moduleInfo.version}. File: ${declarationFile}`);
		}

		moduleInfo.version = parsedVersion;

		// Check file name and normalize path (just in case):
		if (moduleInfo.main == null) {
			throw new Error(`No file to construct specified. File: ${declarationFile}`);
		}

		const normalizedPath = discoveryUtils.normalizeFileName(moduleInfo.main, directory);

		discoveryUtils.pathPrecaution(normalizedPath, directory);

		moduleInfo.main = normalizedPath;

		// Check and set defaults:
		if (moduleInfo["no-alternatives"] == null) moduleInfo["no-alternatives"] = true;
		if (moduleInfo.entrypoint == null) moduleInfo.entrypoint = "default";

		return moduleInfo;
	} catch (err) {
		LOG("warn", "Module Search: Cannot read module information", err);

		return undefined;
	}
}

// TODO: Extract above module info preparation to an another public (?) function

/**
 * Lookups for route in the directory
 * @param directory Directory to look up for route
 * @throws Throws an error if one of the pathes does not belong to the directory
 * @returns Routing within the directory or `undefined`
 * @ignore
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
