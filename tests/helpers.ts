import { createHmac } from "node:crypto";
import {
	Client,
	type ClientOptions,
	type InterruptCreateParams,
	type Message,
} from "../src";

// ---------------------------------------------------------------------------
// Client fixtures
// ---------------------------------------------------------------------------

export const INTERRUPT: InterruptCreateParams = {
	title: "Refund request",
	description: "Agent wants to refund an order.",
	actionRequests: [
		{ name: "refund_order", allowedDecisions: ["approve", "reject"] },
	],
};

export const SUCCESS_BODY = {
	id: "int_1",
	timeOpened: "2026-08-06T14:00:00Z",
	createdAt: "2026-08-06T14:00:00Z",
	updatedAt: "2026-08-06T14:00:00Z",
	organizationId: "org_1",
	externalId: null,
	title: "Refund request",
	answered: false,
	answeredAt: null,
	description: "Agent wants to refund an order.",
	escalated: false,
	assigneeId: null,
	assignee: null,
	classificationId: null,
	classification: null,
	argusSummary: null,
	argusSuggestedDecision: null,
	argusSuggestedResponse: null,
	messages: [],
	actionRequests: [],
	auditEvents: [],
};

export const PROMPT: Message = { type: "human", content: "Refund order #42" };

export const SESSION_BODY = {
	id: "ses_1",
	createdAt: "2026-08-06T14:00:00Z",
	updatedAt: "2026-08-06T14:00:00Z",
	organizationId: "org_1",
	name: "billing-agent",
	externalId: "thread_42",
	status: "active",
	startedAt: "2026-08-06T14:00:00Z",
	endedAt: null,
	escalated: false,
	assigneeId: null,
	assignee: null,
	lastActivityAt: "2026-08-06T14:00:00Z",
	messages: [
		{
			id: "msg_1",
			createdAt: "2026-08-06T14:00:00Z",
			interruptId: null,
			sessionId: "ses_1",
			type: "human",
			content: "Refund order #42",
			name: null,
			toolCallId: null,
			toolStatus: null,
		},
	],
	messageCount: 1,
};

export function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

export type FetchHandler = (request: Request) => Response | Promise<Response>;

/**
 * Build a client whose requests are answered by the given handler, the way
 * the python tests use httpx.MockTransport. Every request the client sends
 * is collected in `requests`, in order.
 */
export function makeClient(
	handler: FetchHandler,
	options: Partial<ClientOptions> = {},
): { client: Client; requests: Request[] } {
	const requests: Request[] = [];
	const fetchStub: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		return handler(request);
	};
	const client = new Client({
		apiKey: "test-key",
		retries: 0,
		fetch: fetchStub,
		...options,
	});
	return { client, requests };
}

// ---------------------------------------------------------------------------
// Webhook fixtures
// ---------------------------------------------------------------------------

export const SECRET_BYTES = Buffer.from("test-signing-secret-32-bytes-ok!");
export const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

// The example payloads from the app's event catalogue (lib/webhook-events.ts).
export const CREATED_PAYLOAD = {
	type: "interrupt.created",
	timestamp: "2025-09-10T08:03:12Z",
	data: {
		id: "8f14e45f-ceea-4672-8657-a1b2c3d4e5f6",
		externalId: "run_42",
		title: "Send onboarding email",
		description: "The agent wants to email a new customer.",
		classification: "billing",
		actionRequests: [
			{
				name: "send_email",
				args: { to: "customer@example.com" },
				allowedDecisions: ["approve", "edit", "reject"],
			},
		],
	},
};

export const ANSWERED_PAYLOAD = {
	type: "interrupt.answered",
	timestamp: "2025-09-10T08:11:47Z",
	data: {
		id: "8f14e45f-ceea-4672-8657-a1b2c3d4e5f6",
		externalId: "run_42",
		title: "Send onboarding email",
		answered: true,
		answeredAt: "2025-09-10T08:11:47Z",
		actionRequests: [
			{
				name: "send_email",
				decision: "approve",
				decidedByName: "Ada Lovelace",
				editedArgs: null,
				responseText: null,
			},
		],
	},
};

export const ESCALATED_PAYLOAD = {
	type: "interrupt.escalated",
	timestamp: "2025-09-10T09:20:05Z",
	data: {
		id: "8f14e45f-ceea-4672-8657-a1b2c3d4e5f6",
		externalId: "run_42",
		title: "Send onboarding email",
		escalated: true,
	},
};

export const SESSION_STARTED_PAYLOAD = {
	type: "session.started",
	timestamp: "2025-09-10T08:00:00Z",
	data: {
		id: "3c9d2b7a-1f0e-4b6a-9d21-abcdefabcdef",
		externalId: "thread_42",
		name: "billing-agent",
		startedAt: "2025-09-10T08:00:00Z",
	},
};

export const SESSION_ENDED_PAYLOAD = {
	type: "session.ended",
	timestamp: "2025-09-10T08:24:31Z",
	data: {
		id: "3c9d2b7a-1f0e-4b6a-9d21-abcdefabcdef",
		externalId: "thread_42",
		name: "billing-agent",
		startedAt: "2025-09-10T08:00:00Z",
		endedAt: "2025-09-10T08:24:31Z",
		reason: "agent",
	},
};

export const SESSION_ACTION_PAYLOAD = {
	type: "session.action",
	timestamp: "2025-09-10T08:12:09Z",
	data: {
		id: "3c9d2b7a-1f0e-4b6a-9d21-abcdefabcdef",
		externalId: "thread_42",
		name: "billing-agent",
		action: "pause",
		triggeredBy: "Ada Lovelace",
	},
};

export interface SignOptions {
	secret?: Buffer;
	messageId?: string;
	/** Unix timestamp in seconds; defaults to now. */
	timestamp?: number;
}

/**
 * Build the Svix signature headers for a body, the way Svix signs deliveries.
 * Uses node:crypto on purpose - an implementation independent of the SDK's
 * WebCrypto path.
 */
export function sign(
	body: string,
	{ secret = SECRET_BYTES, messageId = "msg_1", timestamp }: SignOptions = {},
): Record<string, string> {
	const ts = String(Math.floor(timestamp ?? Date.now() / 1000));
	const signature = createHmac("sha256", secret)
		.update(`${messageId}.${ts}.${body}`)
		.digest("base64");
	return {
		"svix-id": messageId,
		"svix-timestamp": ts,
		"svix-signature": `v1,${signature}`,
	};
}

/** Serialize a payload the way the delivery body arrives on the wire. */
export function encode(payload: unknown): string {
	return JSON.stringify(payload);
}
