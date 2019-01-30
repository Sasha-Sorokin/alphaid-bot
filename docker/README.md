# Alphaid Bot Docker Images

<img align="left" width="150" src="https://i.imgur.com/FDSiq6L.gif" alt="Docker Swarm animated picture"/>

**This folder contains everything related to Docker**.

Docker deployment is still early feature and may not work correctly. When deploying to production, we highly recommend you to try manually set up the bot.

Although, some testing will be appreciated.

Don't forget to share your feedback on [our Discord servers](/README.md#discord-servers).

---

## Deployment Example

> ⚠ **Beware when using on Windows**!
>
> Docker Toolbox for Windows is **not supported** (and will not be).
> Use [Docker CE](https://docs.docker.com/install/) for this.
> The bot may work weird or buggy on Windows, because it is hosted inside of Hyper-V VM.
>
> Find you any issues with Docker images on Windows, you may report them —
> read the [Contributing Guide here](/CONTRIBUTING.md) to get started.

```bash
# Clone repository
git clone https://github.com/Sasha-Sorokin/alphaid-bot.git
cd alphaid-bot

# Initializate all modules
git submodule init
git submodule update --recursive

# Build code using gulp default task
gulp

# Edit the configuration
# -------------------------

# IMPORTANT !!!
# Example files in "out/config" directory are outdated, please look at interface in file linked below for the actual configuration example:
# https://github.com/Sasha-Sorokin/alphaid-bot/blob/master/src/types/SnowballBot.ts#L9

# Place your "configuration.production.json" in "out/.data/alphaid/configs"

cd out

mkdir .data

touch configuration.production.json

editor configuration.production.json

cd ..

# End editing configuration
# -------------------------
```

Done. Take a short break by copying your files to the server and installing docker there (shouldn't be so hard).

Commands below are run on the `out` directory pushed to the server with Docker already installed.

```bash
# Build all images
docker-compose build

# If required, may edit some docker configuration
# Remember that they can be overwritten next time you copy files to server

# code docker-compose.yml

# Finally, starting the bot! :tada:
# If you want to see realtime logs (recommended), remove "-d" flag
docker-compose up -d

# Completely stop the bot
docker-compose down
```

After the stars some modules may require you to configure them. They may create exapmle configuration files for yourself within the `.data/alphaid/configs` directory, or you need to make one manually in the same directory following the module instructions.

---

*Animated image at the top of this document is found on [Docker Swarm Week page](https://goto.docker.com/swarm-week.html), optimized using [ezgif.com](https://ezgif.com/) and uploaded to [Imgur](https://imgur.com/).*
