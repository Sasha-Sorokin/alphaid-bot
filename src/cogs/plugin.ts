export class Plugin {
    events:Map<string, Function> = new Map<string, Function>();

    constructor(events:Object) {
        Object.keys(events).forEach((key) => {
            this.events.set(key, events[key]);
        });
        this.handleEvents();
    }

    handleEvents() {
        this.events.forEach((value, key) => {
            discordBot.on(key, value);
        });
    }

    unhandleEvents() {
        this.events.forEach((value, key) => {
            discordBot.removeListener(key, value);
        });
    }
}