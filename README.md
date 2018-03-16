# Snowball - Mei's friend [![Crowdin](https://d322cqt584bo4o.cloudfront.net/snowball-bot/localized.svg)](https://crowdin.com/project/snowball-bot) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Mei has beautiful friend called Snowball, which used to make the Blizzard and cease enemy resistance. By the way, this bot is not used to be in fights, it's just good friend that helps you with your server.

## Our Discord servers

Join one of our hubs and chat with other hosts, translators and code maintainers!

| International Hub | Russian Hub |
|:---:|:---:|
| [![Server banner](https://discordapp.com/api/guilds/343298261244968960/embed.png?style=banner3)](https://s.dafri.top/sb_isrv) | [![Server banner](https://discordapp.com/api/guilds/331101356205015041/embed.png?style=banner3)](https://s.dafri.top/sb_srv) |

## Installing

### Compile

#### Installing dependencies

To install bot, you need to have installed LATEST version of [NodeJS](https://nodejs.org/). Then, you should install TypeScript compiler and dependencies by running these commands:

**NPM**:

```bash
npm install -g typescript
npm install
```

**Yarn**:

> ⚠ **YARN IS NOT SUPPORTED AT THE MOMENT.** We love yarn, but there's a big problem comes with it: no git subpackages updates. As we started to use alpha releases of `discord.js`, typings of `discord.js` don't get downloaded by yarn. It causes errors on build and kills code editor's linting + suggestions.

```bash
yarn global add typescript
yarn install
```

#### Building

Before building be sure to download all submodules using `git submodule update --init --recursive`.

Then try to run `gulp`, we also have a list of tasks:

- `lint` - lints all TypeScript files in `src`
- `build` - runs compilation and copying of extra files
  - `compile` - runs TypeScript compilation
  - `necessary-copying` - copies extra files (including language files)

All compiled files will stay in directory named `out`.

### Setup

Now when you compiled your own build of Snowball, you must configure everything, so it'll work.

Create file named `configuration.json` in `out/config` directory. See [`configuration.example.json`](./src/out/config/configuration.example.json)

You can have different configuration files for each of `NODE_ENV`, for example:

- `configuration.production.json`
- `configuration.development.json`
- and so on...

#### Configuration file properties

- **`name`** ([`string`][string]): Name of the bot, used for output in console
- **`token`** ([`string`][string]): Bot authorization token, get it on [My Apps](https://discordapp.com/developers/applications/me) Discord Developers page
- **`modules`** ([`IModuleInfo[]`](./src/types/ModuleLoader.ts#L6)): Array of objects with information about a module to register
  - `name` ([`string`][string]): Name of a module
  - `path` ([`string`][string]): Absolute path from `cogs` directory
  - `options` ([`any`][any]): Any options for a module
- **`autoLoad`** ([`string`][string]): Array of names of plugins which should be automatically loaded after registration, be sure you typing their names right: case matters, it's not path.
- **`botOwner`** ([`string`][string]): Your (owner) Discord ID. It gives you permission to call `eval` command and other stuff which can do damage to bot if you type wrong ID here
- **`localizerOptions`** ([`ILocalizerOptions`](./src/types/Localizer.ts#L7)): Configuration of Localizer (aka `i18n settings`)
  - `languages` ([`string[]`][string]): Languages code (file names, e.g. `en-US`)
  - `default_language` ([`string`][string]): Default language code (it'll be used for new servers)
  - `source_language` ([`string`][string]): Source language code (it'll be used as fallback)
  - `directory` ([`string`][string]): Absolute path from `out` directory
  - `disable_coverage_log` ([`boolean`](boolean), **optional**): Disables "Translation Coverage" log which shows all untranslated strings
- **`shardingOptions`**
  - `enabled` ([`boolean`][boolean]): Enabling of sharding mode
  - `shards` ([`number`][number]): Number of shards to start
- **`ravenUrl`** ([`string`][string], **optional**): Your URL for Raven generated by [Sentry.io][sentry], this allows to catch all the errors in more nicer look

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String
[boolean]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Boolean
[number]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Number
[any]:https://www.typescriptlang.org/docs/handbook/basic-types.html#any

### Database

I like to use [MySQL](https://www.mysql.com/) database, compatible with nice [`knexjs`](http://knexjs.org/) library. You need to install it and setup user `snowballbot`. Put password into environment variable named `DB_PASSWD`. If you want, you can set different name for user, database name and even host IP using these environment variables:

- `DB_HOST`: Where database is hosted (`127.0.0.1` by default)
- `DB_NAME`: Name of database where bot will store their tables (`snowbot` by default)
- `DB_PASSWD`: Password for database user
- `DB_USER`: Name of user who connecting to database (`snowballbot` by default)

To insure saving of unicode 8 emojis I changed `my.cfg` (thanks Google):

```ini
[mysqld]
init_connect='SET collation_connection = utf8mb4_unicode_ci'
init_connect='SET NAMES utf8mb4'
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
skip-character-set-client-handshake

[mysql]
default-character-set=utf8mb4
```

### Redis

For caching some data we use [Redis](https://redis.io/).

You can download it [here](https://redis.io/download).

We also have some environment properties for that:

- `REDIS_HOST`: Where Redis is hosted (`127.0.0.1` by default)
- `REDIS_PORT`: Redis port (`6379` by default)
- `REDIS_PASSWD`: Redis password (none by default)

### Start

You had to setup database, environment variables and configuration json file (locally).

Now, in your folder `out` there's compiled version of your bot into JS. Push it to your VPS and then start use.

```bash
# installing all deps (that's why we copied package.json)
npm i --production
# making run.sh executable on local machine
chmod +x ./run.sh
# booting up the bot
./run.sh
```

:tada: This should work. Doesn't work? Create new Issue and I'll gonna say what's wrong

## Contribution

### Pull Requests

I really appreciate your contribution to this project. You can fix my errors, create new good modules.

**There's a few requirements to every pull request:**

- **You must commit to Gitlab origin**. (Github is our mirror for people who have problems with Gitlab and want to fork project there)
- You must not create or fix language files, this is [done only on Crowdin](https://crowdin.com/project/snowball-bot)
- You must not have any errors while running TSLint (`tslint -p .`)
- You must document all the changes you do in format `[moduleName]: [changes description]` (subject to change later)
  - `[moduleName]` can be simplied with:
    - `*` to replace "any of" (example - `profiles:*: added docs for plugins` -> `added docs for any of profiles plugins`)
    - `{*}` if you changed many different files (example - `{*}: small refactoring` -> `small refactoring in *any* files`)
    - `moduleName{addition,secondAddition,...}` to exclude duplicates names (example - `package{,-lock}.json: added some dependency` (notice this comma `,-l...`!) -> `added some dependency in package.json and package.json`)
  - if you unsure about commit message - ask us on our Discord server!

**Some pro tips:**

- Use [Visual Studio **Code**](https://code.visualstudio.com/), it's awesome editor for TypeScript.
  - [TSLint extension](https://marketplace.visualstudio.com/items?itemName=eg2.tslint) allows you to see most of TSLint errors without running it
  - [Indent Rainbow](https://marketplace.visualstudio.com/items?itemName=oderwat.indent-rainbow) allows you to see indentation more clearly
  - [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) to send HTTP requests without leaving editor
  - [Better Comments](https://marketplace.visualstudio.com/items?itemName=aaron-bond.better-comments) - improvements for comments
- Use utilites in `utils` folder while writing code, they are pretty simple.
- Make plugin for all servers, not only yours. To be honest, you can create cog for `shib channel` - that's fine (I included same cogs in source just for fun), but you should provide support for other servers if you're making *serious* plugins like `Overwatch statistic`.

Don't be scared of making Pull Requests! I will suggest you what needed :)

#### Don't know what to start with?

See our [TODO list](./TODO.md) to know what we started and help us developing the things!

### Issues

If you're regular user, then report bugs on [our Discord server](#discord-servers). You also can ask any questions there or just have fun chatting with other members.

If you're developer - report bugs in Issues section **on Gitlab**.

### Private Modules

You can create private modules without commiting them to public, it's totally fine. Just put your module in `private_cogs` directory, it will be ignored by git.

---
**BOT MADE WITH ♥ BY DAFRI_NOCHITEROV**.

*Mei is hero from [Overwatch](https://playoverwatch.com/), game created by [Blizzard](blizzard.com)*.

*Snowball icon originally created by [Rubious Marie](http://rubiousmarie.tumblr.com/) [?]*

[sentry]:https://sentry.io/
