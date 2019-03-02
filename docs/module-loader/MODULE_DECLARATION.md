# Alphaid Module Loader

## Module Declaration

```yaml
name: module-name
version: 0.0.1
dependencies:
    dependency: ^0.1.2?
    dependency-2: 1.3.X
main: ./Module
entrypoint: Module
```

### `name`

Declares a module name to use by other dependencies

There are no clear name conventions for names at the moment. But a few requirements according to `ModuleLoader#moduleNameRegexp` static property:

- Names may contain only the following characters:
  - Latin letters (A-Z, case insensetive)
  - `_`, `-`, `.`
  - Any numbers (0-9)
- Names must be 3-32 characters in length

### `description` (unused)

Declares a description for the module.

### `node_modules` (auto)

Declares if module is loaded from `node_modules` directory and some properties can be read from `package.json` file.

The following values can be skipped in declaration file for node modules:

- [`version`](#version)
- [`main`](#main)

This value is set automatically on discovery stage, do not declare this in module declaration file.

### `version`

Declares a semantic version of the module.

`MAJOR.MINOR.PATCH`

- [Read more about semantic versioning →](https://semver.org/)

### `dependencies`

Declares a list of depencies of the module. The module itself is added as a dependent to the dependencies requested.

Dependencies are listed by name, then a version range the module accepts.

Optional dependencies are marked by using a question mark (`?`) at the end of version range.

- [Read more about semantic versioner for NPM →](https://www.npmjs.com/package/semver)

### `main`

Declares a path to the file to require. Extension is not necessary, do not put `.ts`.

### `entrypoint` (optional)

Declares a name of the property in returned object by requesting file listed in `main`.

Defaults to `default` to simplify exporting in the module class file:

```ts
/**
 * Default entry point
 */
export default Module;
```

Property in the object must be a valid ES6 class.

- [Read more about Module Class Files →](./MODULE_FILE.md)

### `no_alternatives` (optional)

Declares if only one instance of module with such name is allowed.

This can be set to `false` for modules that do not change anything and used by other modules to proceed data.

Otherwise, if module registers commands or changes behavior of the instance, this must be set to `true`.

Defaults to `true`  to avoid conflicts with other versions.
