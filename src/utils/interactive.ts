import { Message, MessageReaction, User, TextChannel, GuildMember, DMChannel } from "discord.js";
import { getMessageMember, getMessageMemberOrAuthor, IEmbed } from "@utils/utils";
import * as Bluebird from "bluebird";
import * as getLogger from "loggy";

/**
 * Logger for all the things that happen with module
 * @todo Must be removed, no important data logged
 * @ignore
 */
const LOG = getLogger("Utils:Interactive");

/**
 * Text for error if no `onCancel` value has been passed
 * 
 * Mostly that means that cancellation support was not enabled in Bluebird
 * @ignore
 */
const ERR_INVALID_PROMISE = "Invalid promise, expected onCancel to be passed";

/**
 * Simple yes-no teller
 * @param bool Boolean value
 * @ignore
 */
function yesNo(bool: boolean) {
	return bool ? "Yes" : "No";
}

/**
 * Emoji for action
 * @ignore
 */
const enum ActionReactionEmoji {
	WHITE_CHECK_MARK = "✅",
	RED_CROSS_MARK = "❌"
}

/**
 * Creates confirmation message in response to other message
 * @param embed Embed for the confirmation dialog
 * @param originalMsg Original message for reference
 * @returns Boolean value of whether confirmation dialog was accepted or not
 */
export function createConfirmationMessage(embed: IEmbed, originalMsg: Message): Bluebird<boolean> {
	let logContext = `(CMS / 0:${originalMsg.id})`;

	return new Bluebird(
		async (resolve, _reject) => {
			let confirmMsg: Message | undefined;

			try {
				confirmMsg = <Message> await originalMsg.channel.send(
					"", {
						embed: <any> embed
					}
				);
			} catch (err) {
				LOG("info", `${logContext} Message sending failure`, err.message);

				return false;
			}

			logContext = `(CMD / 1:${confirmMsg.id})`;

			const author = await getMessageMemberOrAuthor(originalMsg);

			if (!author) {
				throw new Error("Cannot get original message author");
			}

			const isText = confirmMsg.channel.type === "text";

			let canUseMessages = true;
			let canUseReactions = true;

			if (isText) {
				LOG("info", `${logContext} Is text channel, check permissions...`);

				const myPermissions = await getPermissions(confirmMsg);

				if (!myPermissions) {
					throw new Error("Failed to check bot's permissions in the channel");
				}

				canUseReactions = myPermissions.has("ADD_REACTIONS");

				const authorPermissions = await getPermissions(originalMsg);

				if (!authorPermissions) {
					throw new Error("Failed to check author's permissions in the channel");
				}

				canUseMessages = authorPermissions.has("SEND_MESSAGES");
			}

			LOG("info", `${logContext} Can use messages? ${yesNo(canUseMessages)}`);
			LOG("info", `${logContext} Can use reactions? ${yesNo(canUseReactions)}`);

			if (!canUseMessages && !canUseReactions) {
				LOG("warn", `${logContext} Cannot use any of the methods to confirm message`);

				throw new Error("No method to confirm action is found");
			}

			const messageConfirmed = messageWaiter(confirmMsg, author.id);
			const reactionConfirmed = reactionWaiter(confirmMsg, author.id);

			messageConfirmed.then(
				cancel(reactionConfirmed)
			);

			reactionConfirmed.then(
				cancel(messageConfirmed)
			);

			Bluebird
				.race<boolean>([
					messageConfirmed,
					reactionConfirmed
				])
				.timeout(60000)
				.catch(
					() => resolve(false)
				)
				.then(
					(val) => {
						LOG("ok", `${logContext} Resolved as "${val}"`);

						return resolve(!!val);
					}
				);
		}
	);
}

/**
 * Creates a function to cancel Bluebird promise
 * @param promise Promise to be cancelled
 * @ignore
 */
function cancel<T>(promise: Bluebird<T>) {
	return (val: T) => {
		if (promise.isPending()) {
			promise.cancel();
		}

		return val;
	};
}

/**
 * Gets members permissions in channel where message sent
 * @param msg Message sent by member whose permission to get
 * @ignore
 */
async function getPermissions(msg: Message) {
	const member = await getMessageMember(msg);

	if (!member) {
		throw new Error("Cannot find author as a member of the server");
	}

	return member.permissionsIn(msg.channel);
}

// #region Reaction Waiter

/**
 * Reacts to confirmation message with choises and waits for user's response
 * @param confirmationMessage Confirmation message to react on
 * @param authorId ID of the user whose reactions to message are accepted
 * @returns Cancellable promise that resolves once user reacts with vaild emoji
 * @ignore
 */
function reactionWaiter(confirmationMessage: Message, authorId: string): Bluebird<boolean> {
	const logContext = `(RWT / ${confirmationMessage.id})`;

	return new Bluebird.Promise(async (resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		try {
			LOG("info", `${logContext} Add reactions to message`);

			await confirmationMessage.react(ActionReactionEmoji.WHITE_CHECK_MARK);
			await confirmationMessage.react(ActionReactionEmoji.RED_CROSS_MARK);
		} catch (err) {
			return false;
		}

		const reactionCollection = collectReaction(confirmationMessage, authorId);

		onCancel(() => reactionCollection.cancel());

		const res = await reactionCollection;

		resolve(
			res ? res.emoji.name === ActionReactionEmoji.WHITE_CHECK_MARK : false
		);
	});
}

/**
 * Creates a reaction collector for confirmation message and waits for
 * a single reaction to be collected, then resolves with user's reaction
 * @param confirmationMessage Confirmation message to create collector
 * @param authorId ID of the user whose reactions to message are accepted
 * @returns Cancellable promise that resolves with valid user's reaction collected
 * @ignore
 */
function collectReaction(confirmationMessage: Message, authorId: string): Bluebird<MessageReaction | undefined> {
	return new Bluebird(
		(resolve, _reject, onCancel) => {
			if (!onCancel) { throw new Error("Invalid promise, expected onCancel to be passed"); }

			const logContext = `(RCL / ${confirmationMessage.id})`;

			LOG("info", `${logContext} Creating the collector...`);

			const collector = confirmationMessage.createReactionCollector(
				(reaction: MessageReaction, user: User) => {
					LOG("info", `${logContext} Reaction: ${reaction.emoji.name}. User ID: ${user.id}`);

					if (user.id !== authorId) { return false; }

					if (reaction.emoji.name !== "✅" && reaction.emoji.name !== "❌") {
						return false;
					}

					LOG("info", `${logContext} Reaction is accepted and will be collected`);

					return true;
				}, {
					max: 1,
					maxEmojis: 1,
					maxUsers: 1,
					time: 60000
				}
			);

			let isCanceled = false;

			collector.once("end", (collected) => {
				if (isCanceled) { return; }

				LOG("ok", `${logContext} Done - ${collected.size} reaction(s) collected`);

				resolve(collected.first());
			});

			LOG("info", `${logContext} Collector created, confirming acknowledgement...`);

			if (!onCancel) { return; }

			onCancel(async () => {
				if (isCanceled) {
					throw new Error("Could not cancel cancelled");
				}

				LOG(`info`, `${logContext} Cancelling collection...`);

				isCanceled = true;

				collector.stop("cancelled using callback");

				confirmationMessage.reactions.remove("✅");
				confirmationMessage.reactions.remove("❌");

				LOG("ok", `${logContext} Collection cancelled`);

				resolve();
			});
		}
	);
}

// #endregion

//#region Message Waiter

/**
 * Waits for user's text message with text of `y` or `n`
 * @param confirmationMessage Confirmation message for reference
 * @param authorId ID of the user whose messages are accepted
 * @returns Cancellable promis that resolves once user sends a valid message
 * @ignore
 */
function messageWaiter(confirmationMessage: Message, authorId: string) {
	const logContext = `(MWT / ${confirmationMessage.id})`;

	return new Bluebird<boolean>(async (resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		LOG("info", `${logContext} Collect the messages...`);

		const collectectMes = collectMessage(confirmationMessage, authorId);

		onCancel(() => collectectMes.cancel());

		const message = await collectectMes;

		resolve(
			message ? messageToBool(message) : false
		);
	});
}

/**
 * Reads content of message and returns boolean value of choice
 * @param msg Message which content to read
 * @returns `true` if message content is `y`, otherwise `false`
 * @ignore
 * @todo See if this can be deleted from code
 */
function messageToBool(msg: Message): boolean {
	return msg.content === "y";
}

/**
 * Creates a message collector for the channel where message was sent
 * and waits for a single user's message to be collected, then resolves with message
 * @param confirmationMessage Confirmation message for reference
 * @param authorId ID of the user whose messages are accepted
 * @returns Cancellale promise that resolves with user's message collected
 * @ignore
 */
function collectMessage(confirmationMessage: Message, authorId: string) : Bluebird<Message | undefined> {
	const logContext = `(MCL / ${confirmationMessage.id})`;

	return new Bluebird<Message | undefined>((resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		LOG("info", `${logContext} Create the collector...`);

		const collector = confirmationMessage.channel.createMessageCollector(
			collectorCallback(authorId)
		);

		let isCanceled = false;

		collector.once("collect", () => {
			LOG("ok", `${logContext} Element collected. Stop collection...`);

			collector.stop("collected");
		});

		collector.once("end", (collected) => {
			if (isCanceled) { return; }

			LOG("ok", `${logContext} Done - ${collected.size} message(s) collected`);

			resolve(collected.first());
		});

		onCancel(() => {
			isCanceled = true;

			LOG("info", `${logContext} Cancel collection...`);

			collector.stop("cancelled");

			resolve();

			LOG("ok", `${logContext} Collection canceled`);
		});
	});
}

/**
 * Creates a callback for message collector to collect only message by the user
 * @param authorId ID of the user whose messages are accepted
 * @returns Callback for message collector to collect only message by the user
 * @ignore
 */
function collectorCallback(authorId: string): (msg: Message) => boolean {
	// load languages possibly

	const logContext = `(MCB / ${authorId})`;

	return (msg: Message) => {
		LOG("info", `${logContext} Message ID: ${msg.id}. Author ID: ${msg.author.id}`);

		if (msg.author.id !== authorId) { return false; }

		const res = msg.content === "y" || msg.content === "n";

		if (res) {
			LOG("info", `${logContext} Accept message into collection`);
		}

		return res;
	};
}

//#endregion

/**
 * Rules for the custom confirmation message
 */
export interface ICustomConfirmationRules {
	/**
	 * Maximum number of collected reactions
	 */
	max: number;
	/**
	 * Maximum number of emoji to collect
	 */
	maxEmojis: number;
	/**
	 * Maximum number of users to react
	 */
	maxUsers: number;
	/**
	 * Acceptable emoji names
	 */
	variants: string[];
	/**
	 * How much time will the collector run
	 */
	time: number;
	/**
	 * Arroy of users whose reactions are collected
	 */
	whoCanReact?: Array<User | GuildMember>;
}

/**
 * Creates custom confirmation messase in the channel
 * @param embed Embed for the confirmation dialog
 * @param channel Channel where message will be sent
 * @param rules Rules for reaction collection
 * @returns Promise that resolves with collection of reactions
 */
export async function createCustomConfirmationMessage(embed: IEmbed, channel: TextChannel, rules: ICustomConfirmationRules) {
	const _confirmationMessage = <Message> await channel.send({ embed });

	try {
		for (let i = 0, rl = rules.variants.length; i < rl; i++) {
			await _confirmationMessage.react(rules.variants[i]);
		}
	} catch (err) {
		_confirmationMessage.delete();
		throw new Error("Cannot react!");
	}

	return _confirmationMessage.awaitReactions((reaction: MessageReaction, user: User) => {
		if (!rules.variants.includes(reaction.emoji.name)) { return false; }

		if (rules.whoCanReact) {
			return !!rules.whoCanReact.find(u => u.id === user.id);
		}

		return true;
	}, {
		errors: ["time"],
		max: rules.max,
		maxEmojis: rules.maxEmojis,
		maxUsers: rules.maxUsers,
		time: rules.time
	});
}

/**
 * Rules for the message collection
 */
export interface ICustomWaitMessageOptions {
	/**
	 * Acceptable message contents
	 */
	variants: string[];
	/**
	 * How much time will collector run
	 */
	time: number;
	/**
	 * Maximum number of messages to collect
	 */
	max?: number;
	/**
	 * Maximum number of procceded messages
	 */
	maxMatches: number;
	/**
	 * ID of the users whose messages are allowed
	 */
	authors: string[];
}

/**
 * Starts collecting the messages in the channel with custom rules
 * @param channel Channel where to collect messages
 * @param rules Rules for the message collection
 * @returns Promise that resolves with collection of messages
 */
export async function waitForMessages(channel: TextChannel | DMChannel, rules: ICustomWaitMessageOptions) {
	return channel.awaitMessages(
		(msg: Message) => {
			return rules.authors.includes(msg.author.id) && rules.variants.includes(msg.content);
		}, {
			errors: ["time"],
			maxProcessed: rules.maxMatches,
			time: rules.time,
			max: rules.max
		}
	);
}
