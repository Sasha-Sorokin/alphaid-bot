import * as BaseService from "../baseService";
import { IEmbed, sleep, escapeDiscordMarkdown } from "@utils/utils";
import { getUUIDByString } from "@utils/text";
import { default as fetch } from "node-fetch";
import { Carina } from "carina";
import * as ws from "ws";
import * as getLogger from "loggy";
import { EventEmitter } from "events";
import { IHashMap } from "../../../types/Types";

Carina.WebSocket = ws;

const MIXER_ICON = "https://i.imgur.com/fQsQPkd.png";
const MIXER_COLOR = 0x1FBAED;
const MIXER_OFFLINE_BANNER = "https://i.imgur.com/gUM6X2w.jpg";

interface ICacheItem {
	startedAt: number;
	channel: IMixerChannel;
}

class MixerStreamingService extends EventEmitter implements BaseService.IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.mixer";
	}

	public name = "mixer";

	private readonly log = getLogger("MixerStreamingService");

	private readonly ca: Carina;

	constructor(apiKey) {
		super();
		try {
			this.ca = new Carina({
				isBot: apiKey ? false : true,
				authToken: apiKey,
				autoReconnect: true
			}).on("error", (err) => {
				this.log("err", "Carina error", err);
			});
		} catch (err) {
			this.log("err", "Failed to run plugin", err);
		}
	}

	// ========================================
	//           Updates handlers
	// ========================================

	private readonly _carinaListeners: IHashMap<((data) => void)> = Object.create(null);
	private readonly currentData: IHashMap<ICacheItem> = Object.create(null);

	private generateID(cacheItem: ICacheItem) {
		return getUUIDByString(`${this.name.toUpperCase()}::{${cacheItem.startedAt}-${cacheItem.channel.id}}`);
	}

	public async subscribeTo(streamer: BaseService.IStreamingServiceStreamer) {
		const listener = async (data: IMixerChannel) => {
			/**
			* Cached data to check updates
			*/
			let currentData = this.currentData[streamer.uid];
			if (data.online === true) {
				// stream goes online
				const channel = await this.fetchChannel(streamer.uid);
				if (!channel.online) {
					this.log("warn", "We were notified about starting stream of", streamer.uid, "but channel is offline");

					return;
				}
				// start time
				const startedAt = await this.getStreamStartTime(streamer.uid);
				if (!startedAt) {
					this.log("err", "Unknown error with streamer", streamer.uid);

					return;
				}
				currentData = this.currentData[streamer.uid] = {
					startedAt,
					channel
				};
				this.emit("online", {
					streamer,
					status: "online",
					id: this.generateID(currentData),
					payload: currentData
				});
			} else if (currentData) {
				if (data.online === false) {
					// stream goes offline
					this.emit("offline", {
						streamer,
						status: "offline",
						id: this.generateID(currentData),
						payload: currentData
					});

					delete this.currentData[streamer.uid];
				} else {
					const updated = !!data.name || !!data.audience || data.type !== undefined || (data.user && data.user.avatarUrl);
					if (updated) {
						// getting old id
						const oldId = this.generateID(currentData);

						// updating props
						for (const updated in data) {
							this.currentData[streamer.uid][updated] = data[updated];
						}

						// updating started at time
						const startedAt = await this.getStreamStartTime(streamer.uid);

						// updating cached
						this.currentData[streamer.uid].startedAt = startedAt;

						// updating var
						currentData = this.currentData[streamer.uid];

						// emittin'!
						this.emit("updated", {
							streamer,
							status: "online",
							id: this.generateID(currentData),
							oldId,
							updated: true,
							payload: currentData
						});
					}
				}
			}
		};

		this._carinaListeners[streamer.uid] = listener;
		this.ca.subscribe<IMixerChannel>(`channel:${streamer.uid}:update`, listener);
	}

	// ========================================
	//              Subscriptions
	// ========================================

	public addSubscription(streamer: BaseService.IStreamingServiceStreamer) {
		if (this.isSubscribed(streamer.uid)) {
			throw new BaseService.StreamingServiceError("ALREADY_SUBSCRIBED", "Already subscribed to this streamer");
		}
		this.subscribeTo(streamer);
	}

	public removeSubscription(uid: string) {
		const listener = this._carinaListeners[uid];
		if (listener) {
			this.ca.unsubscribe(`channel:${uid}:update`);
			delete this._carinaListeners[uid];
		}
	}

	public isSubscribed(uid: string) {
		return !!this._carinaListeners[uid];
	}

	// ========================================
	//                   API
	// ========================================

	public async fetchChannel(uid: string): Promise<IMixerChannel> {
		return this.makeRequest(this.getAPIURL_Channel(uid));
	}

	public async getStreamStartTime(uid: string): Promise<number> {
		const manifest = <IMixerManifest> await this.makeRequest(`${this.getAPIURL_Channel(uid)}/manifest.light2`);

		return new Date(manifest.startedAt).getTime();
	}

	public getAPIURL_Channel(username: string) {
		return `https://mixer.com/api/v1/channels/${username}`;
	}

	public async getStreamer(username: string): Promise<BaseService.IStreamingServiceStreamer> {
		const json = <IMixerChannel> await this.makeRequest(this.getAPIURL_Channel(username));

		return {
			serviceName: this.name,
			uid: `${json.id}`,
			username: json.token
		};
	}

	private async makeRequest(uri: string, attempt: number = 0): Promise<any> {
		const resp = await fetch(uri);
		if (resp.status === 429) {
			const _retryHeader = resp.headers.get("retry-after");
			if (!_retryHeader) {
				throw new Error("Ratelimited but not given time to wait");
			}
			const delay = parseInt(_retryHeader, 10);
			this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
			await sleep(delay);

			return this.makeRequest(uri, attempt + 1);
		} else if (resp.status === 404) {
			throw new BaseService.StreamingServiceError("MIXER_NOTFOUND", "Resource not found");
		}

		return (resp.json());
	}

	// ========================================
	//                 Discord
	// ========================================

	public async getEmbed(stream: BaseService.IStreamStatus, lang: string): Promise<IEmbed> {
		const cache = <ICacheItem> stream.payload;

		if (!cache) {
			throw new BaseService.StreamingServiceError("MIXER_CACHEFAULT", "Failure: payload not found");
		}

		const gameName = cache.channel.type ? cache.channel.type.name : $localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN");

		return {
			footer: {
				icon_url: MIXER_ICON,
				text: "Mixer"
			},
			timestamp: cache.channel.updatedAt,
			author: {
				icon_url: cache.channel.user.avatarUrl,
				name: cache.channel.user.username,
				url: `https://mixer.com/${cache.channel.token}`
			},
			thumbnail: {
				width: 128,
				height: 128,
				url: cache.channel.user.avatarUrl || MIXER_ICON
			},
			description: $localizer.getFormattedString(lang, stream.status === "online" ? "STREAMING_DESCRIPTION" : "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(cache.channel.user.username, true)
			}),
			title: cache.channel.name,
			url: `https://mixer.com/${cache.channel.token}`,
			color: MIXER_COLOR,
			image: {
				url: stream.status === "online" ? `https://thumbs.beam.pro/channel/${cache.channel.id}.big.jpg?ts=${Date.now()}` : (
					cache.channel.bannerUrl || MIXER_OFFLINE_BANNER
				)
			},
			fields: [{
				inline: gameName.length < 25,
				name: $localizer.getString(lang, "STREAMING_GAME_NAME"),
				value: gameName
			}, {
				inline: true,
				name: $localizer.getString(lang, "STREAMING_MATURE_NAME"),
				value: $localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_MIXER", {
					audience: cache.channel.audience
				})
			}]
		};
	}

	// ========================================
	//              Module Stuff
	// ========================================

	public async start() {
		this.ca.open();
	}

	public emit(type: BaseService.StreamStatusChangedAction, update: BaseService.IStreamStatus) {
		return super.emit(type, update);
	}

	public async unload() {
		for (const uid in this._carinaListeners) {
			this.removeSubscription(uid);
		}

		return true;
	}
}

interface IMixerChannel {
	/**
	 * Channel ID
	 */
	id: string;
	/**
	 * Channel name
	 */
	token: string;
	/**
	 * Name of the stream
	 */
	name: string;
	/**
	 * Viewers (current)
	 */
	viewersCurrent: number;
	/**
	 * Viewers (total)
	 */
	viewersTotal: number;
	/**
	 * Followers
	 */
	numFollowers: number;
	/**
	 * Latest time channel was updated (streaming also updates it)
	 */
	updatedAt: string;
	/**
	 * Details about game
	 */
	type: {
		/**
		 * Name of game
		 */
		name: string
	} | null;
	/**
	 * Online?
	 */
	online: boolean;
	/**
	 * User info
	 */
	user: {
		/**
		 * Avatar URL
		 */
		avatarUrl?: string;
		/**
		 * Username
		 */
		username: string;
	};
	/**
	 * Audience of stream
	 */
	audience: "teen" | "18+" | "family";

	/** Link to the banner */
	bannerUrl?: string;
}

interface IMixerManifest {
	now: string;
	startedAt: string;
}

module.exports = MixerStreamingService;
