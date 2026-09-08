import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APIError,
	Client,
	type Message,
	NotFoundError,
	UsageLimitError,
	ValidationError,
	VigilatorConnectionError,
	WorkspaceLimitError,
} from "../src";
import {
	INTERRUPT,
	jsonResponse,
	makeClient,
	PROMPT,
	SESSION_BODY,
	SUCCESS_BODY,
} from "./helpers";

afterEach(() => {
	vi.useRealTimers();
});

describe("Client", () => {
	it("requires an api key", () => {
		expect(() => new Client({ apiKey: "" })).toThrow(TypeError);
	});

	it("normalises the base url so relative api paths resolve under it", () => {
		expect(new Client({ apiKey: "k" }).baseUrl).toBe(
			"https://api.vigilator.dev/",
		);
		expect(
			new Client({ apiKey: "k", baseUrl: "http://localhost:3000" }).baseUrl,
		).toBe("http://localhost:3000/");
	});
});

describe("createInterrupt", () => {
	it("returns the created interrupt on a 2xx response", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SUCCESS_BODY),
		);

		const result = await client.createInterrupt(INTERRUPT);

		expect(result.id).toBe("int_1");
		expect(result.answered).toBe(false);

		const request = requests[0];
		expect(request?.method).toBe("POST");
		expect(new URL(request?.url ?? "").pathname).toBe("/api/interrupts");
		expect(request?.headers.get("x-api-key")).toBe("test-key");
		expect(request?.headers.get("content-type")).toBe("application/json");
		// Unset optional fields are omitted, not sent as nulls.
		expect(await request?.json()).toEqual({
			title: "Refund request",
			description: "Agent wants to refund an order.",
			actionRequests: [
				{ name: "refund_order", allowedDecisions: ["approve", "reject"] },
			],
		});
	});

	it("throws UsageLimitError on 402 USAGE_LIMIT_REACHED", async () => {
		const { client } = makeClient(() =>
			jsonResponse(402, {
				defined: true,
				code: "USAGE_LIMIT_REACHED",
				status: 402,
				message: "Usage limit reached",
				data: { featureId: "interrupts", message: "Upgrade your plan." },
			}),
		);

		const error = await client.createInterrupt(INTERRUPT).catch((e) => e);

		expect(error).toBeInstanceOf(UsageLimitError);
		expect(error).toBeInstanceOf(APIError);
		expect(error.status).toBe(402);
		expect(error.code).toBe("USAGE_LIMIT_REACHED");
		expect(error.message).toBe("Usage limit reached");
		expect(error.data).toEqual({
			featureId: "interrupts",
			message: "Upgrade your plan.",
		});
	});

	it("throws WorkspaceLimitError on 403 WORKSPACE_LIMIT_REACHED", async () => {
		const { client } = makeClient(() =>
			jsonResponse(403, {
				defined: true,
				code: "WORKSPACE_LIMIT_REACHED",
				status: 403,
				message: "Workspace limit reached",
				data: { message: "Workspace limit reached" },
			}),
		);

		await expect(client.createInterrupt(INTERRUPT)).rejects.toBeInstanceOf(
			WorkspaceLimitError,
		);
	});

	it("throws WorkspaceLimitError on 403 ORGANISATION_LIMIT_REACHED", async () => {
		const { client } = makeClient(() =>
			jsonResponse(403, {
				defined: true,
				code: "ORGANISATION_LIMIT_REACHED",
				status: 403,
				message: "Organisation limit reached",
				data: { message: "Organisation limit reached" },
			}),
		);

		await expect(client.createInterrupt(INTERRUPT)).rejects.toBeInstanceOf(
			WorkspaceLimitError,
		);
	});

	it("throws a plain APIError with the status when the error body is not JSON", async () => {
		const { client } = makeClient(
			() =>
				new Response("Internal Server Error", {
					status: 500,
					statusText: "Internal Server Error",
				}),
		);

		const error = await client.createInterrupt(INTERRUPT).catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.status).toBe(500);
		expect(error.code).toBe("UNKNOWN");
		expect(error.message).toBe("Internal Server Error");
	});

	it("throws VigilatorConnectionError when the API cannot be reached", async () => {
		const cause = new TypeError("fetch failed");
		const { client } = makeClient(() => {
			throw cause;
		});

		const error = await client.createInterrupt(INTERRUPT).catch((e) => e);

		expect(error).toBeInstanceOf(VigilatorConnectionError);
		expect(error.message).toBe("fetch failed");
		expect(error.cause).toBe(cause);
	});

	it("rejects an interrupt without action requests before sending", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SUCCESS_BODY),
		);

		await expect(
			client.createInterrupt({ ...INTERRUPT, actionRequests: [] }),
		).rejects.toBeInstanceOf(ValidationError);
		expect(requests).toHaveLength(0);
	});
});

describe("getInterrupt", () => {
	it("returns the interrupt on a 2xx response", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SUCCESS_BODY),
		);

		const result = await client.getInterrupt("int_1");

		expect(result.id).toBe("int_1");
		const request = requests[0];
		expect(request?.method).toBe("GET");
		expect(new URL(request?.url ?? "").pathname).toBe("/api/interrupts/int_1");
		expect(request?.headers.get("x-api-key")).toBe("test-key");
		expect(request?.headers.get("content-type")).toBeNull();
	});

	it("percent-encodes the id so it cannot alter the request path", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SUCCESS_BODY),
		);

		await client.getInterrupt("a/b");

		expect(requests[0]?.url.endsWith("/api/interrupts/a%2Fb")).toBe(true);
	});

	it("throws NotFoundError on 404 NOT_FOUND", async () => {
		const { client } = makeClient(() =>
			jsonResponse(404, {
				defined: false,
				code: "NOT_FOUND",
				status: 404,
				message: "Interrupt not found.",
			}),
		);

		const error = await client.getInterrupt("missing").catch((e) => e);

		expect(error).toBeInstanceOf(NotFoundError);
		expect(error.status).toBe(404);
		expect(error.code).toBe("NOT_FOUND");
	});
});

describe("startSession", () => {
	it("returns the session on a 2xx response", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SESSION_BODY),
		);

		const session = await client.startSession("billing-agent", {
			externalId: "thread_42",
			messages: [PROMPT],
		});

		expect(session.id).toBe("ses_1");
		expect(session.status).toBe("active");
		expect(session.messageCount).toBe(1);
		expect(session.messages[0]?.content).toBe("Refund order #42");

		const request = requests[0];
		expect(request?.method).toBe("POST");
		expect(new URL(request?.url ?? "").pathname).toBe("/api/sessions");
		expect(request?.headers.get("x-api-key")).toBe("test-key");
		// Options map onto the API's camelCase body; unset optional fields are
		// omitted, not sent as nulls.
		expect(await request?.json()).toEqual({
			name: "billing-agent",
			externalId: "thread_42",
			messages: [{ type: "human", content: "Refund order #42" }],
		});
	});

	it("sends only the name when no opening context is given", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SESSION_BODY),
		);

		await client.startSession("billing-agent");

		expect(await requests[0]?.json()).toEqual({ name: "billing-agent" });
	});

	it("rejects input that breaks the API contract without sending a request", async () => {
		const { client, requests } = makeClient(() => {
			throw new Error("no request must be sent");
		});

		await expect(client.startSession("")).rejects.toBeInstanceOf(
			ValidationError,
		);
		expect(requests).toHaveLength(0);
	});

	it("throws UsageLimitError when the agent hours are exhausted", async () => {
		const { client } = makeClient(() =>
			jsonResponse(402, {
				defined: true,
				code: "USAGE_LIMIT_REACHED",
				status: 402,
				message: "Usage limit reached",
				data: {
					featureId: "agent_hours_monitored",
					message: "Upgrade to Pro.",
				},
			}),
		);

		const error = await client.startSession("billing-agent").catch((e) => e);

		expect(error).toBeInstanceOf(UsageLimitError);
		expect(error.data).toEqual({
			featureId: "agent_hours_monitored",
			message: "Upgrade to Pro.",
		});
	});
});

describe("appendSessionMessages", () => {
	it("posts to the session's messages endpoint and returns the session", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, { ...SESSION_BODY, messageCount: 2 }),
		);

		const reply: Message = {
			type: "ai",
			content: "Refunding now.",
			name: "billing-agent",
		};
		const session = await client.appendSessionMessages("ses_1", [reply]);

		expect(session.messageCount).toBe(2);
		const request = requests[0];
		expect(request?.method).toBe("POST");
		expect(new URL(request?.url ?? "").pathname).toBe(
			"/api/sessions/ses_1/messages",
		);
		expect(await request?.json()).toEqual({
			messages: [
				{ type: "ai", content: "Refunding now.", name: "billing-agent" },
			],
		});
	});

	it("rejects an empty batch without sending a request", async () => {
		const { client, requests } = makeClient(() => {
			throw new Error("no request must be sent");
		});

		await expect(
			client.appendSessionMessages("ses_1", []),
		).rejects.toBeInstanceOf(ValidationError);
		expect(requests).toHaveLength(0);
	});

	it("surfaces an ended session as a plain APIError with code CONFLICT", async () => {
		const { client } = makeClient(() =>
			jsonResponse(409, {
				defined: false,
				code: "CONFLICT",
				status: 409,
				message: "Session has already ended.",
			}),
		);

		const error = await client
			.appendSessionMessages("ses_1", [PROMPT])
			.catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.constructor).toBe(APIError);
		expect(error.status).toBe(409);
		expect(error.code).toBe("CONFLICT");
		expect(error.message).toBe("Session has already ended.");
	});

	it("serialises a tool result as a first-class tool message tied to its call", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, { ...SESSION_BODY, messageCount: 3 }),
		);

		const call: Message = {
			type: "ai",
			content: "Looking it up.",
			name: "billing-agent",
			toolCalls: [{ id: "call_1", name: "lookup_order", args: { id: "42" } }],
		};
		const result: Message = {
			type: "tool",
			content: '{"status": "refunded"}',
			name: "lookup_order",
			toolCallId: "call_1",
			toolStatus: "success",
		};
		await client.appendSessionMessages("ses_1", [call, result]);

		const sent = (await requests[0]?.json()) as { messages: unknown[] };
		expect(sent.messages[1]).toEqual({
			type: "tool",
			content: '{"status": "refunded"}',
			name: "lookup_order",
			toolCallId: "call_1",
			toolStatus: "success",
		});
	});
});

describe("endSession", () => {
	it("posts to the end endpoint with no body", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, {
				...SESSION_BODY,
				status: "ended",
				endedAt: "2026-08-06T14:30:00Z",
			}),
		);

		const session = await client.endSession("ses_1");

		expect(session.status).toBe("ended");
		expect(session.endedAt).not.toBeNull();
		const request = requests[0];
		expect(request?.method).toBe("POST");
		expect(new URL(request?.url ?? "").pathname).toBe(
			"/api/sessions/ses_1/end",
		);
		expect(request?.headers.get("content-type")).toBeNull();
		expect(await request?.text()).toBe("");
	});

	it("percent-encodes the id so it cannot alter the request path", async () => {
		const { client, requests } = makeClient(() =>
			jsonResponse(200, SESSION_BODY),
		);

		await client.endSession("a/b");

		expect(requests[0]?.url.endsWith("/api/sessions/a%2Fb/end")).toBe(true);
	});

	it("throws NotFoundError on 404 NOT_FOUND", async () => {
		const { client } = makeClient(() =>
			jsonResponse(404, {
				defined: false,
				code: "NOT_FOUND",
				status: 404,
				message: "Session not found.",
			}),
		);

		await expect(client.endSession("missing")).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});
});

describe("retries", () => {
	it("retries 429/502/503/504 responses and connection errors, then succeeds", async () => {
		const responses = [
			() => jsonResponse(503, { code: "UNAVAILABLE", message: "down" }),
			() => {
				throw new TypeError("fetch failed");
			},
			() => jsonResponse(429, { code: "RATE_LIMITED", message: "slow down" }),
			() => jsonResponse(200, SUCCESS_BODY),
		];
		const { client, requests } = makeClient(
			() => (responses.shift() ?? responses[0])?.() as Response,
			{ retries: 3, backoffFactor: 0 },
		);

		const result = await client.createInterrupt(INTERRUPT);

		expect(result.id).toBe("int_1");
		expect(requests).toHaveLength(4);
	});

	it("gives up after the configured number of retries", async () => {
		const { client, requests } = makeClient(
			() => jsonResponse(503, { code: "UNAVAILABLE", message: "down" }),
			{ retries: 2, backoffFactor: 0 },
		);

		const error = await client.getInterrupt("int_1").catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.status).toBe(503);
		expect(requests).toHaveLength(3);
	});

	it("does not retry other error statuses", async () => {
		const { client, requests } = makeClient(
			() => jsonResponse(400, { code: "BAD_REQUEST", message: "nope" }),
			{ retries: 3, backoffFactor: 0 },
		);

		await expect(client.getInterrupt("int_1")).rejects.toBeInstanceOf(APIError);
		expect(requests).toHaveLength(1);
	});

	it("waits for the Retry-After header before retrying", async () => {
		vi.useFakeTimers();
		const responses = [
			() => jsonResponse(429, { message: "slow down" }, { "retry-after": "2" }),
			() => jsonResponse(200, SUCCESS_BODY),
		];
		const { client, requests } = makeClient(
			() => responses.shift()?.() as Response,
			{ retries: 1, backoffFactor: 0 },
		);

		const pending = client.getInterrupt("int_1");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(requests).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1_000);
		const result = await pending;

		expect(result.id).toBe("int_1");
		expect(requests).toHaveLength(2);
	});

	it("aborts an attempt that exceeds the timeout", async () => {
		const { client } = makeClient(
			(request) =>
				new Promise((_, reject) => {
					request.signal.addEventListener("abort", () =>
						reject(request.signal.reason),
					);
				}),
			{ timeout: 20 },
		);

		const error = await client.getInterrupt("int_1").catch((e) => e);

		expect(error).toBeInstanceOf(VigilatorConnectionError);
		expect(error.message).toBe("Request timed out after 20 ms.");
	});
});
