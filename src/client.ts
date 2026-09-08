/**
 * Client for the Vigilator API.
 *
 * Built on the platform `fetch`, so it runs unchanged on Node 20+, Bun, Deno
 * and edge runtimes. Requests that fail with 429/502/503/504 or a connection
 * error are retried with exponential backoff.
 */

import { APIError, ERROR_CLASSES, VigilatorConnectionError } from "./errors";
import type {
	Interrupt,
	InterruptCreateParams,
	Message,
	Session,
	SessionStartOptions,
} from "./types";
import {
	validateAppendMessages,
	validateId,
	validateInterruptCreateParams,
	validateSessionStart,
} from "./validate";

export const DEFAULT_BASE_URL = "https://api.vigilator.dev";
export const DEFAULT_RETRIES = 5;
export const DEFAULT_BACKOFF_FACTOR = 0.5;
/** Default request timeout, in milliseconds. */
export const DEFAULT_TIMEOUT = 5_000;

// Retries only fire on statuses where the request is normally not processed
// by the server, so POSTs (createInterrupt, startSession, ...) are retried too.
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);
// Upper bound for a single backoff wait, in seconds - also caps Retry-After.
const MAX_BACKOFF_WAIT = 120;

export interface ClientOptions {
	/** API key associated with the desired organisation. Sent as the `x-api-key` header. */
	apiKey: string;
	/** Base URL of the Vigilator API. */
	baseUrl?: string;
	/** How often to retry requests that fail with 429/502/503/504 or a connection error. */
	retries?: number;
	/** Multiplier, in seconds, for the exponential delay between retries. */
	backoffFactor?: number;
	/** Timeout for each request attempt, in milliseconds. */
	timeout?: number;
	/**
	 * The `fetch` implementation to use instead of the global one - mainly
	 * useful for tests, where a stub can answer requests without a network.
	 */
	fetch?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds to wait before a retry, per the `Retry-After` header when present. */
function retryAfterSeconds(header: string | null): number | undefined {
	if (header === null) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds);
	const date = Date.parse(header);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, (date - Date.now()) / 1000);
}

async function errorFromResponse(response: Response): Promise<APIError> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	const envelope =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: {};
	const code = typeof envelope.code === "string" ? envelope.code : "UNKNOWN";
	const message =
		typeof envelope.message === "string" && envelope.message.length > 0
			? envelope.message
			: response.statusText || `HTTP ${response.status}`;
	const ErrorClass = ERROR_CLASSES[code] ?? APIError;
	return new ErrorClass(response.status, code, message, envelope.data);
}

function describeConnectionError(error: unknown, timeout: number): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError") {
			return `Request timed out after ${timeout} ms.`;
		}
		return error.message || error.name;
	}
	return String(error);
}

/**
 * Handles authenticated requests for the Vigilator API.
 *
 * @example
 * ```ts
 * const client = new Client({ apiKey: "vgl_..." });
 * const interrupt = await client.createInterrupt({ ... });
 * ```
 */
export class Client {
	/** Base URL of the Vigilator API, always ending in `/`. */
	readonly baseUrl: string;
	readonly retries: number;
	readonly backoffFactor: number;
	/** Timeout for each request attempt, in milliseconds. */
	readonly timeout: number;

	readonly #apiKey: string;
	readonly #fetch: typeof fetch | undefined;

	constructor(options: ClientOptions) {
		if (!options.apiKey) {
			throw new TypeError("An apiKey is required to create a Client.");
		}
		this.#apiKey = options.apiKey;
		this.#fetch = options.fetch;
		const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
		this.retries = options.retries ?? DEFAULT_RETRIES;
		this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
	}

	/**
	 * Create an interrupt.
	 *
	 * @param params The interrupt to create: a title, a description and at
	 *   least one action request, plus optionally a classification, your own
	 *   correlation id and the conversation leading up to it.
	 * @returns The created interrupt as returned by the API.
	 * @throws {ValidationError} The params break the API contract; nothing was sent.
	 * @throws {APIError} The API responded with an error status code. Quota
	 *   errors throw the more specific `UsageLimitError`, `PlanRequiredError`,
	 *   `AddonRequiredError` or `WorkspaceLimitError` subclasses.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async createInterrupt(params: InterruptCreateParams): Promise<Interrupt> {
		validateInterruptCreateParams(params);
		return this.#request<Interrupt>("POST", "api/interrupts", params);
	}

	/**
	 * Fetch a single interrupt by id, including decisions on its action requests.
	 *
	 * Poll this after opening an interrupt to learn the outcome: `answered`
	 * flips true once every action request is decided.
	 *
	 * @param interruptId Id of the interrupt to fetch.
	 * @returns The interrupt as returned by the API.
	 * @throws {APIError} The API responded with an error status code. A
	 *   missing interrupt throws the more specific `NotFoundError` subclass.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async getInterrupt(interruptId: string): Promise<Interrupt> {
		validateId("interruptId", interruptId);
		return this.#request<Interrupt>(
			"GET",
			`api/interrupts/${encodeURIComponent(interruptId)}`,
		);
	}

	/**
	 * Start a live agent session, so its conversation can be watched in Live View.
	 *
	 * Call this when an agent run starts, stream the conversation with
	 * {@link appendSessionMessages} as it progresses, and close it with
	 * {@link endSession} when the run completes. A session that goes quiet
	 * for longer than the organisation's session timeout is ended
	 * automatically.
	 *
	 * @param name The agent's name as shown in Live View, e.g. `"billing-agent"`.
	 * @param options `externalId`: your own correlation id for the run, e.g.
	 *   the run or thread id in your agent framework. `messages`: the opening
	 *   context, e.g. the user prompt that started the run (at most 200).
	 * @returns The created session as returned by the API; keep its `id` for
	 *   the append and end calls.
	 * @throws {ValidationError} The arguments break the API contract; nothing was sent.
	 * @throws {APIError} The API responded with an error status code. Quota
	 *   errors throw the more specific `UsageLimitError`, `PlanRequiredError`,
	 *   `AddonRequiredError` or `WorkspaceLimitError` subclasses.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async startSession(
		name: string,
		options: SessionStartOptions = {},
	): Promise<Session> {
		validateSessionStart(name, options);
		return this.#request<Session>("POST", "api/sessions", {
			name,
			externalId: options.externalId,
			messages: options.messages,
		});
	}

	/**
	 * Append messages to a running session, so watchers see the transcript grow live.
	 *
	 * @param sessionId Id of the session, as returned by {@link startSession}.
	 * @param messages The messages to append, in conversation order. Between
	 *   1 and 200 messages per call.
	 * @returns The session as returned by the API, including its most recent
	 *   messages and the total `messageCount`.
	 * @throws {ValidationError} The batch breaks the API contract; nothing was sent.
	 * @throws {APIError} The API responded with an error status code. A
	 *   missing session throws the more specific `NotFoundError` subclass; a
	 *   session that has already ended is a 409 `CONFLICT`.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async appendSessionMessages(
		sessionId: string,
		messages: readonly Message[],
	): Promise<Session> {
		validateId("sessionId", sessionId);
		validateAppendMessages(messages);
		return this.#request<Session>(
			"POST",
			`api/sessions/${encodeURIComponent(sessionId)}/messages`,
			{ messages },
		);
	}

	/**
	 * End a live agent session when the run completes.
	 *
	 * Ending an already-ended session is a no-op that returns the current
	 * state, so it is safe to retry.
	 *
	 * @param sessionId Id of the session, as returned by {@link startSession}.
	 * @returns The ended session as returned by the API.
	 * @throws {APIError} The API responded with an error status code. A
	 *   missing session throws the more specific `NotFoundError` subclass.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async endSession(sessionId: string): Promise<Session> {
		validateId("sessionId", sessionId);
		return this.#request<Session>(
			"POST",
			`api/sessions/${encodeURIComponent(sessionId)}/end`,
		);
	}

	/** Seconds to wait before retry number `attempt` (1-based). */
	#backoff(attempt: number, retryAfter: string | null): number {
		const fromHeader = retryAfterSeconds(retryAfter);
		if (fromHeader !== undefined) return Math.min(fromHeader, MAX_BACKOFF_WAIT);
		const exponential = this.backoffFactor * 2 ** (attempt - 1);
		// Full jitter spreads retries from many clients apart.
		return Math.min(exponential, MAX_BACKOFF_WAIT) * Math.random();
	}

	/**
	 * Send a request and return the decoded JSON body of a successful response.
	 *
	 * @throws {APIError} The API responded with an error status code.
	 * @throws {VigilatorConnectionError} The API could not be reached.
	 */
	async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = new URL(path, this.baseUrl).toString();
		const headers: Record<string, string> = {
			"x-api-key": this.#apiKey,
			accept: "application/json",
		};
		let serialized: string | undefined;
		if (body !== undefined) {
			headers["content-type"] = "application/json";
			serialized = JSON.stringify(body);
		}
		const fetchImpl = this.#fetch ?? globalThis.fetch;

		for (let attempt = 0; ; attempt++) {
			let response: Response;
			try {
				response = await fetchImpl.call(globalThis, url, {
					method,
					headers,
					body: serialized,
					signal: AbortSignal.timeout(this.timeout),
				});
			} catch (error) {
				if (attempt < this.retries) {
					await sleep(this.#backoff(attempt + 1, null) * 1000);
					continue;
				}
				throw new VigilatorConnectionError(
					describeConnectionError(error, this.timeout),
					{ cause: error },
				);
			}
			if (response.ok) {
				return (await response.json()) as T;
			}
			if (RETRY_STATUSES.has(response.status) && attempt < this.retries) {
				await sleep(
					this.#backoff(attempt + 1, response.headers.get("retry-after")) *
						1000,
				);
				continue;
			}
			throw await errorFromResponse(response);
		}
	}
}
