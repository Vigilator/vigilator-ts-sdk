/**
 * Verify and dispatch webhook events delivered by Vigilator.
 *
 * Vigilator delivers webhooks through Svix, which signs every delivery with
 * the `svix-id`, `svix-timestamp` and `svix-signature` headers using the
 * Standard Webhooks scheme (HMAC-SHA256 over `{id}.{timestamp}.{raw_body}`).
 * The event payload types here mirror Vigilator's published payload contract;
 * they are hand-written on purpose, as webhook payloads are not part of the
 * OpenAPI spec that `generated/api.d.ts` comes from.
 *
 * Verification uses WebCrypto (`crypto.subtle`), so every method is async and
 * the handler works on Node 20+, Bun, Deno and edge runtimes alike.
 */

import { ValidationError, WebhookVerificationError } from "./errors";
import type { Decision, JsonObject, SessionEndReason } from "./types";

/** Maximum allowed clock skew (either direction) for `svix-timestamp`, in seconds. */
export const DEFAULT_TOLERANCE = 300;

const WHSEC_PREFIX = "whsec_";
const SIGNATURE_VERSION = "v1";

const ERR_BAD_WHSEC =
	"The signing secret is not valid: expected 'whsec_' followed by base64.";
const ERR_MISSING_HEADERS =
	"Missing svix-id, svix-timestamp or svix-signature header.";
const ERR_BAD_TIMESTAMP = "The svix-timestamp header is not a Unix timestamp.";
const ERR_TIMESTAMP_TOO_OLD =
	"The svix-timestamp header is too old; possible replay.";
const ERR_TIMESTAMP_TOO_NEW = "The svix-timestamp header is in the future.";
const ERR_BODY_NOT_UTF8 = "The request body is not valid UTF-8.";
const ERR_NO_MATCHING_SIGNATURE =
	"No signature in svix-signature matches the request body.";
const ERR_BODY_NOT_JSON = "The verified request body is not valid JSON.";
const ERR_BODY_NOT_EVENT =
	"The verified request body is not a webhook event envelope.";

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/** The envelope every event shares: `timestamp` is when the lifecycle edge happened, not the delivery time. */
export interface WebhookEnvelope<Type extends string, Data> {
	type: Type;
	timestamp: string;
	data: Data;
}

/** An action the agent proposed on a newly created interrupt. */
export interface CreatedActionRequest {
	name: string;
	args: JsonObject;
	allowedDecisions: Decision[];
}

/** Payload of an `interrupt.created` event. */
export interface InterruptCreatedData {
	id: string;
	externalId: string | null;
	title: string;
	description: string;
	classification: string | null;
	actionRequests: CreatedActionRequest[];
}

/** An agent opened a new interrupt. */
export type InterruptCreatedEvent = WebhookEnvelope<
	"interrupt.created",
	InterruptCreatedData
>;

/** The reviewer's decision on one action request of an answered interrupt. */
export interface AnsweredActionRequest {
	name: string;
	decision: Decision | null;
	decidedByName: string | null;
	/** Edit only: the reviewer's replacement for the proposed args. */
	editedArgs: JsonObject | null;
	/** Respond: the answer. Reject: an optional reason. */
	responseText: string | null;
}

/** Payload of an `interrupt.answered` event. */
export interface InterruptAnsweredData {
	id: string;
	externalId: string | null;
	title: string;
	answered: true;
	answeredAt: string;
	actionRequests: AnsweredActionRequest[];
}

/** Every action request on an interrupt was decided. */
export type InterruptAnsweredEvent = WebhookEnvelope<
	"interrupt.answered",
	InterruptAnsweredData
>;

/** Payload of an `interrupt.escalated` event. */
export interface InterruptEscalatedData {
	id: string;
	externalId: string | null;
	title: string;
	escalated: true;
}

/** An interrupt was raised to the escalated queue. */
export type InterruptEscalatedEvent = WebhookEnvelope<
	"interrupt.escalated",
	InterruptEscalatedData
>;

/** Fields shared by every `session.*` payload. */
export interface SessionEventData {
	id: string;
	externalId: string | null;
	/** The agent's self-declared name, e.g. `"billing-agent"`. */
	name: string;
}

/** Payload of a `session.started` event. */
export interface SessionStartedData extends SessionEventData {
	startedAt: string;
}

/** An agent registered a live session. */
export type SessionStartedEvent = WebhookEnvelope<
	"session.started",
	SessionStartedData
>;

/** Payload of a `session.ended` event. */
export interface SessionEndedData extends SessionEventData {
	startedAt: string;
	endedAt: string;
	reason: SessionEndReason;
}

/** A live session ended - by the agent, a watcher, the session timeout, or the organisation's usage limit. */
export type SessionEndedEvent = WebhookEnvelope<
	"session.ended",
	SessionEndedData
>;

/** Payload of a `session.action` event. */
export interface SessionActionData extends SessionEventData {
	/** The custom action's name, as defined on the organisation's integrations page. */
	action: string;
	/** The member who fired the action from Live View. */
	triggeredBy: string;
}

/** A watcher fired a custom action against a live session. */
export type SessionActionEvent = WebhookEnvelope<
	"session.action",
	SessionActionData
>;

/**
 * A verified event whose type this SDK version does not know.
 *
 * Newer Vigilator event types fall through to this shape instead of throwing,
 * so handlers written against an older SDK keep working. Upgrade the SDK to
 * get a typed event.
 */
export interface UnknownEvent {
	type: string;
	timestamp?: string;
	data?: unknown;
}

/** Event type -> event, for the event types this SDK version knows. */
export interface WebhookEventMap {
	"interrupt.created": InterruptCreatedEvent;
	"interrupt.answered": InterruptAnsweredEvent;
	"interrupt.escalated": InterruptEscalatedEvent;
	"session.started": SessionStartedEvent;
	"session.ended": SessionEndedEvent;
	"session.action": SessionActionEvent;
}

export type WebhookEventType = keyof WebhookEventMap;

/** Any event `constructEvent` / `handle` can return. */
export type WebhookEvent = WebhookEventMap[WebhookEventType] | UnknownEvent;

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<WebhookEventType>([
	"interrupt.created",
	"interrupt.answered",
	"interrupt.escalated",
	"session.started",
	"session.ended",
	"session.action",
]);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The raw request body, exactly as received. */
export type WebhookBody = string | Uint8Array | ArrayBuffer;

/**
 * The request headers, as a `Headers` instance or a plain object (Node's
 * `IncomingHttpHeaders`, Express, Fastify, ...). Names are matched
 * case-insensitively.
 */
export type WebhookHeaders =
	| Headers
	| Record<string, string | string[] | undefined>;

/** A callback registered with {@link WebhookHandler.on}. */
export type WebhookCallback<Event> = (event: Event) => void | Promise<void>;

export interface WebhookHandlerOptions {
	/** The endpoint's signing secret from the Vigilator dashboard, with or without the `whsec_` prefix. */
	secret: string;
	/**
	 * Maximum allowed clock skew for `svix-timestamp`, in seconds. Deliveries
	 * outside the window are rejected to prevent replay attacks.
	 */
	tolerance?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict base64 decoding without Buffer, so it works everywhere `atob` does. */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
		throw new SyntaxError("Invalid base64.");
	}
	const binary = atob(value);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function getHeader(headers: WebhookHeaders, name: string): string | undefined {
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) continue;
		return Array.isArray(value) ? value[0] : value;
	}
	return undefined;
}

function bodyToString(body: WebhookBody): string {
	if (typeof body === "string") return body;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(body);
	} catch {
		throw new WebhookVerificationError(ERR_BODY_NOT_UTF8);
	}
}

/** Compares two digests without leaking where they differ through timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index++) {
		diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
	}
	return diff === 0;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Verifies Vigilator webhook deliveries and dispatches them to callbacks.
 *
 * The handler is framework-agnostic: feed it the raw request body and the
 * request headers from any web framework. Always pass the raw body as
 * received - re-serializing parsed JSON breaks the signature.
 *
 * @example
 * ```ts
 * const webhooks = new WebhookHandler({ secret: "whsec_..." });
 *
 * webhooks.on("interrupt.answered", async (event) => {
 *   // resume the agent run with event.data.actionRequests
 * });
 *
 * // inside the route: await webhooks.handle(rawBody, request.headers)
 * ```
 */
export class WebhookHandler {
	/** Maximum allowed clock skew for `svix-timestamp`, in seconds. */
	readonly tolerance: number;

	readonly #secret: Uint8Array<ArrayBuffer>;
	#key: Promise<CryptoKey> | undefined;
	// biome-ignore lint/suspicious/noExplicitAny: callbacks are typed per event at registration; the map stores them erased.
	readonly #callbacks = new Map<string, WebhookCallback<any>[]>();

	/**
	 * @throws {WebhookVerificationError} The secret is not valid base64.
	 */
	constructor(options: WebhookHandlerOptions) {
		const encoded = options.secret.startsWith(WHSEC_PREFIX)
			? options.secret.slice(WHSEC_PREFIX.length)
			: options.secret;
		try {
			this.#secret = decodeBase64(encoded);
		} catch {
			throw new WebhookVerificationError(ERR_BAD_WHSEC);
		}
		if (this.#secret.length === 0) {
			throw new WebhookVerificationError(ERR_BAD_WHSEC);
		}
		this.tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
	}

	/**
	 * Register a callback for one event type.
	 *
	 * The callback receives the typed event for known types. Unknown types are
	 * allowed too, so callbacks can target event types newer than this SDK
	 * version; they receive an {@link UnknownEvent}.
	 *
	 * @returns A function that removes the callback again.
	 */
	on<Type extends WebhookEventType>(
		type: Type,
		callback: WebhookCallback<WebhookEventMap[Type]>,
	): () => void;
	on(type: string, callback: WebhookCallback<UnknownEvent>): () => void;
	on(type: string, callback: WebhookCallback<WebhookEvent>): () => void {
		let callbacks = this.#callbacks.get(type);
		if (callbacks === undefined) {
			callbacks = [];
			this.#callbacks.set(type, callbacks);
		}
		callbacks.push(callback);
		return () => {
			const index = callbacks.indexOf(callback);
			if (index !== -1) callbacks.splice(index, 1);
		};
	}

	/**
	 * Verify the Svix signature of a delivery, without parsing the body.
	 *
	 * @param body Raw request body, exactly as received.
	 * @param headers Request headers; names are matched case-insensitively.
	 * @throws {WebhookVerificationError} Headers are missing or malformed, the
	 *   timestamp is outside the tolerance window, or no signature matches
	 *   the body.
	 */
	async verify(body: WebhookBody, headers: WebhookHeaders): Promise<void> {
		await this.#verify(body, headers);
	}

	/**
	 * Verify a delivery and parse its body into a typed event.
	 *
	 * The payload is trusted once its signature checks out: known event types
	 * are returned as their typed shape without a field-by-field validation,
	 * matching Vigilator's stable payload contract.
	 *
	 * @param body Raw request body, exactly as received.
	 * @param headers Request headers; names are matched case-insensitively.
	 * @returns The typed event; an {@link UnknownEvent} when the event type
	 *   postdates this SDK version.
	 * @throws {WebhookVerificationError} The delivery failed verification or
	 *   the body is not valid JSON.
	 * @throws {ValidationError} The verified payload is not an event envelope.
	 */
	async constructEvent(
		body: WebhookBody,
		headers: WebhookHeaders,
	): Promise<WebhookEvent> {
		const text = await this.#verify(body, headers);
		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch {
			throw new WebhookVerificationError(ERR_BODY_NOT_JSON);
		}
		if (
			typeof payload !== "object" ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new WebhookVerificationError(ERR_BODY_NOT_EVENT);
		}
		const event = payload as Record<string, unknown>;
		if (typeof event.type !== "string") {
			throw new ValidationError([
				{ path: "type", message: "must be a string" },
			]);
		}
		if (KNOWN_EVENT_TYPES.has(event.type)) {
			const issues = [];
			if (typeof event.timestamp !== "string") {
				issues.push({ path: "timestamp", message: "must be a string" });
			}
			if (typeof event.data !== "object" || event.data === null) {
				issues.push({ path: "data", message: "must be an object" });
			}
			if (issues.length > 0) throw new ValidationError(issues);
		}
		return event as unknown as WebhookEvent;
	}

	/**
	 * Verify a delivery, parse it, and invoke the callbacks registered for its type.
	 *
	 * Callbacks run one after another in registration order and are awaited;
	 * an error thrown by a callback propagates. Return a 2xx quickly after
	 * this call and offload slow work, as Svix retries failed deliveries.
	 *
	 * @param body Raw request body, exactly as received.
	 * @param headers Request headers; names are matched case-insensitively.
	 * @returns The typed event, after all callbacks for it have run.
	 * @throws {WebhookVerificationError} The delivery failed verification or
	 *   the body is not valid JSON.
	 * @throws {ValidationError} The verified payload is not an event envelope.
	 */
	async handle(
		body: WebhookBody,
		headers: WebhookHeaders,
	): Promise<WebhookEvent> {
		const event = await this.constructEvent(body, headers);
		const callbacks = [...(this.#callbacks.get(event.type) ?? [])];
		for (const callback of callbacks) {
			await callback(event);
		}
		return event;
	}

	#getKey(): Promise<CryptoKey> {
		this.#key ??= crypto.subtle.importKey(
			"raw",
			this.#secret,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		return this.#key;
	}

	/** Reject timestamps outside the tolerance window, to prevent replays. */
	#checkTimestamp(timestamp: string): void {
		const value = Number(timestamp);
		if (timestamp.trim().length === 0 || !Number.isFinite(value)) {
			throw new WebhookVerificationError(ERR_BAD_TIMESTAMP);
		}
		const now = Date.now() / 1000;
		if (value < now - this.tolerance) {
			throw new WebhookVerificationError(ERR_TIMESTAMP_TOO_OLD);
		}
		if (value > now + this.tolerance) {
			throw new WebhookVerificationError(ERR_TIMESTAMP_TOO_NEW);
		}
	}

	/** Verifies the delivery and returns the body as text, for parsing. */
	async #verify(body: WebhookBody, headers: WebhookHeaders): Promise<string> {
		const messageId = getHeader(headers, "svix-id");
		const timestamp = getHeader(headers, "svix-timestamp");
		const signatureHeader = getHeader(headers, "svix-signature");
		if (!messageId || !timestamp || !signatureHeader) {
			throw new WebhookVerificationError(ERR_MISSING_HEADERS);
		}
		this.#checkTimestamp(timestamp);

		const text = bodyToString(body);
		const key = await this.#getKey();
		const signedContent: BufferSource = new TextEncoder().encode(
			`${messageId}.${timestamp}.${text}`,
		);
		const expected = new Uint8Array(
			await crypto.subtle.sign("HMAC", key, signedContent),
		);

		// The header holds space-delimited "<version>,<base64>" entries; any
		// matching v1 signature verifies the delivery.
		for (const candidate of signatureHeader.split(" ")) {
			const separator = candidate.indexOf(",");
			if (separator === -1) continue;
			if (candidate.slice(0, separator) !== SIGNATURE_VERSION) continue;
			let signature: Uint8Array;
			try {
				signature = decodeBase64(candidate.slice(separator + 1));
			} catch {
				continue;
			}
			if (timingSafeEqual(expected, signature)) return text;
		}
		throw new WebhookVerificationError(ERR_NO_MATCHING_SIGNATURE);
	}
}
