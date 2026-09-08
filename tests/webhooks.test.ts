import { describe, expect, it } from "vitest";
import {
	type InterruptAnsweredEvent,
	type InterruptCreatedEvent,
	type SessionActionEvent,
	type SessionEndedEvent,
	ValidationError,
	WebhookHandler,
	WebhookVerificationError,
} from "../src";
import {
	ANSWERED_PAYLOAD,
	CREATED_PAYLOAD,
	ESCALATED_PAYLOAD,
	encode,
	SECRET,
	SECRET_BYTES,
	SESSION_ACTION_PAYLOAD,
	SESSION_ENDED_PAYLOAD,
	SESSION_STARTED_PAYLOAD,
	sign,
} from "./helpers";

const handler = () => new WebhookHandler({ secret: SECRET });

describe("constructEvent", () => {
	it("parses a signed interrupt.created delivery", async () => {
		const body = encode(CREATED_PAYLOAD);
		const event = await handler().constructEvent(body, sign(body));

		expect(event.type).toBe("interrupt.created");
		const created = event as InterruptCreatedEvent;
		expect(created.data.externalId).toBe("run_42");
		expect(created.data.classification).toBe("billing");
		const request = created.data.actionRequests[0];
		expect(request?.args).toEqual({ to: "customer@example.com" });
		expect(request?.allowedDecisions).toEqual(["approve", "edit", "reject"]);
	});

	it("parses a signed interrupt.answered delivery", async () => {
		const body = encode(ANSWERED_PAYLOAD);
		const event = (await handler().constructEvent(
			body,
			sign(body),
		)) as InterruptAnsweredEvent;

		expect(event.type).toBe("interrupt.answered");
		expect(event.data.answered).toBe(true);
		const request = event.data.actionRequests[0];
		expect(request?.decision).toBe("approve");
		expect(request?.decidedByName).toBe("Ada Lovelace");
		expect(request?.editedArgs).toBeNull();
	});

	it("parses a signed interrupt.escalated delivery", async () => {
		const body = encode(ESCALATED_PAYLOAD);
		const event = await handler().constructEvent(body, sign(body));

		expect(event).toMatchObject({
			type: "interrupt.escalated",
			data: { escalated: true },
		});
	});

	it("parses a signed session.started delivery", async () => {
		const body = encode(SESSION_STARTED_PAYLOAD);
		const event = await handler().constructEvent(body, sign(body));

		expect(event).toMatchObject({
			type: "session.started",
			data: {
				externalId: "thread_42",
				name: "billing-agent",
				startedAt: "2025-09-10T08:00:00Z",
			},
		});
	});

	it("parses a signed session.ended delivery with its reason", async () => {
		const body = encode(SESSION_ENDED_PAYLOAD);
		const event = (await handler().constructEvent(
			body,
			sign(body),
		)) as SessionEndedEvent;

		expect(event.data.reason).toBe("agent");
		expect(Date.parse(event.data.endedAt)).toBeGreaterThan(
			Date.parse(event.data.startedAt),
		);
	});

	it("parses a signed session.action delivery", async () => {
		const body = encode(SESSION_ACTION_PAYLOAD);
		const event = (await handler().constructEvent(
			body,
			sign(body),
		)) as SessionActionEvent;

		expect(event.data.action).toBe("pause");
		expect(event.data.triggeredBy).toBe("Ada Lovelace");
	});

	it("accepts the body as bytes", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body);
		const bytes = new TextEncoder().encode(body);

		await expect(
			handler().constructEvent(bytes, headers),
		).resolves.toMatchObject({ type: "interrupt.created" });
		await expect(
			handler().constructEvent(bytes.buffer as ArrayBuffer, headers),
		).resolves.toMatchObject({ type: "interrupt.created" });
	});

	it("accepts the signing secret with or without the whsec_ prefix", async () => {
		const body = encode(ESCALATED_PAYLOAD);
		const bare = new WebhookHandler({
			secret: SECRET_BYTES.toString("base64"),
		});

		await expect(bare.constructEvent(body, sign(body))).resolves.toMatchObject({
			type: "interrupt.escalated",
		});
	});

	it("rejects a secret that is not valid base64 at construction", () => {
		expect(() => new WebhookHandler({ secret: "whsec_not!base64" })).toThrow(
			WebhookVerificationError,
		);
		expect(() => new WebhookHandler({ secret: "whsec_" })).toThrow(
			WebhookVerificationError,
		);
	});

	it("rejects a body that differs from the signed one", async () => {
		const headers = sign(encode(CREATED_PAYLOAD));
		const tampered = encode({
			...CREATED_PAYLOAD,
			type: "interrupt.escalated",
		});

		await expect(handler().constructEvent(tampered, headers)).rejects.toThrow(
			WebhookVerificationError,
		);
	});

	it("rejects a delivery signed with a different secret", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body, {
			secret: Buffer.from("some-other-signing-secret-bytes!"),
		});

		await expect(handler().constructEvent(body, headers)).rejects.toThrow(
			WebhookVerificationError,
		);
	});

	it("rejects a delivery without the Svix headers", async () => {
		const body = encode(CREATED_PAYLOAD);

		await expect(handler().constructEvent(body, {})).rejects.toThrow(
			WebhookVerificationError,
		);
		await expect(handler().constructEvent(body, new Headers())).rejects.toThrow(
			WebhookVerificationError,
		);
	});

	it("rejects a timestamp older than the tolerance as a possible replay", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body, { timestamp: Date.now() / 1000 - 600 });

		await expect(handler().constructEvent(body, headers)).rejects.toThrow(
			/too old/,
		);
	});

	it("rejects a timestamp further in the future than the tolerance", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body, { timestamp: Date.now() / 1000 + 600 });

		await expect(handler().constructEvent(body, headers)).rejects.toThrow(
			/in the future/,
		);
	});

	it("honours a custom tolerance", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body, { timestamp: Date.now() / 1000 - 600 });
		const lenient = new WebhookHandler({ secret: SECRET, tolerance: 900 });

		await expect(lenient.constructEvent(body, headers)).resolves.toMatchObject({
			type: "interrupt.created",
		});
	});

	it("rejects a svix-timestamp header that is not a number", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = { ...sign(body), "svix-timestamp": "yesterday" };

		await expect(handler().constructEvent(body, headers)).rejects.toThrow(
			/not a Unix timestamp/,
		);
	});

	it("accepts any matching v1 signature among several", async () => {
		const body = encode(CREATED_PAYLOAD);
		const headers = sign(body);
		const good = headers["svix-signature"];
		const bogus = Buffer.alloc(32, "0").toString("base64");
		headers["svix-signature"] =
			`v1a,${bogus} v1,not-base64 v1,${bogus} ${good}`;

		await expect(
			handler().constructEvent(body, headers),
		).resolves.toMatchObject({ type: "interrupt.created" });
	});

	it("matches header names case-insensitively, whatever the framework passes", async () => {
		const body = encode(CREATED_PAYLOAD);
		const signed = sign(body);
		const titleCased = Object.fromEntries(
			Object.entries(signed).map(([key, value]) => [
				key.replace(
					/(^|-)([a-z])/g,
					(_, sep, letter) => `${sep}${letter.toUpperCase()}`,
				),
				value,
			]),
		);
		const arrays = Object.fromEntries(
			Object.entries(signed).map(([key, value]) => [key, [value]]),
		);

		await expect(
			handler().constructEvent(body, titleCased),
		).resolves.toMatchObject({ type: "interrupt.created" });
		await expect(handler().constructEvent(body, arrays)).resolves.toMatchObject(
			{ type: "interrupt.created" },
		);
		await expect(
			handler().constructEvent(body, new Headers(signed)),
		).resolves.toMatchObject({ type: "interrupt.created" });
	});

	it("falls through to an UnknownEvent for event types newer than this SDK", async () => {
		const payload = {
			type: "interrupt.reopened",
			timestamp: "2025-09-10T10:00:00Z",
			data: { id: "int_1" },
		};
		const body = encode(payload);
		const event = await handler().constructEvent(body, sign(body));

		expect(event.type).toBe("interrupt.reopened");
		expect(event.data).toEqual({ id: "int_1" });
	});

	it("rejects a verified body that is not JSON", async () => {
		const body = "not json";

		await expect(handler().constructEvent(body, sign(body))).rejects.toThrow(
			WebhookVerificationError,
		);
	});

	it("rejects a verified body that is not an event envelope", async () => {
		const array = encode([1, 2, 3]);
		await expect(handler().constructEvent(array, sign(array))).rejects.toThrow(
			WebhookVerificationError,
		);

		const untyped = encode({ data: {} });
		await expect(
			handler().constructEvent(untyped, sign(untyped)),
		).rejects.toThrow(ValidationError);

		const malformed = encode({ type: "interrupt.created", timestamp: 1 });
		const error = await handler()
			.constructEvent(malformed, sign(malformed))
			.catch((e) => e);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error.issues.map((issue: { path: string }) => issue.path)).toEqual([
			"timestamp",
			"data",
		]);
	});

	it("rejects a body that is not valid UTF-8", async () => {
		const body = new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]);
		const headers = sign("{}");

		await expect(handler().constructEvent(body, headers)).rejects.toThrow(
			/not valid UTF-8/,
		);
	});
});

describe("verify", () => {
	it("resolves for a valid delivery and rejects otherwise", async () => {
		const body = encode(CREATED_PAYLOAD);
		await expect(handler().verify(body, sign(body))).resolves.toBeUndefined();
		await expect(handler().verify("tampered", sign(body))).rejects.toThrow(
			WebhookVerificationError,
		);
	});
});

describe("handle", () => {
	it("invokes the callbacks registered for the event's type, and only those", async () => {
		const webhooks = handler();
		const received: InterruptAnsweredEvent[] = [];
		webhooks.on("interrupt.answered", (event) => {
			received.push(event);
		});
		webhooks.on("interrupt.created", () => {
			throw new Error("callback for another event type must not run");
		});

		const body = encode(ANSWERED_PAYLOAD);
		const event = await webhooks.handle(body, sign(body));

		expect(received).toEqual([event]);
		expect(event.type).toBe("interrupt.answered");
	});

	it("routes each session event type to its own callbacks", async () => {
		const webhooks = handler();
		const received: string[] = [];
		webhooks.on("session.ended", (event: SessionEndedEvent) => {
			received.push(event.data.reason);
		});
		webhooks.on("session.action", async (event: SessionActionEvent) => {
			await Promise.resolve();
			received.push(event.data.action);
		});

		for (const payload of [
			SESSION_STARTED_PAYLOAD,
			SESSION_ENDED_PAYLOAD,
			SESSION_ACTION_PAYLOAD,
		]) {
			const body = encode(payload);
			await webhooks.handle(body, sign(body));
		}

		expect(received).toEqual(["agent", "pause"]);
	});

	it("awaits callbacks in registration order and stops unsubscribed ones", async () => {
		const webhooks = handler();
		const order: string[] = [];
		const off = webhooks.on("interrupt.escalated", async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push("first");
		});
		webhooks.on("interrupt.escalated", () => {
			order.push("second");
		});

		const body = encode(ESCALATED_PAYLOAD);
		await webhooks.handle(body, sign(body));
		off();
		await webhooks.handle(body, sign(body));

		expect(order).toEqual(["first", "second", "second"]);
	});

	it("dispatches unknown event types to callbacks registered by name", async () => {
		const webhooks = handler();
		const seen: string[] = [];
		webhooks.on("interrupt.reopened", (event) => {
			seen.push(event.type);
		});

		const body = encode({ type: "interrupt.reopened", data: {} });
		await webhooks.handle(body, sign(body));

		expect(seen).toEqual(["interrupt.reopened"]);
	});

	it("propagates an error thrown by a callback", async () => {
		const webhooks = handler();
		webhooks.on("interrupt.escalated", () => {
			throw new Error("boom");
		});

		const body = encode(ESCALATED_PAYLOAD);
		await expect(webhooks.handle(body, sign(body))).rejects.toThrow("boom");
	});

	it("still verifies and returns the event when nothing is registered", async () => {
		const body = encode(ESCALATED_PAYLOAD);
		const event = await handler().handle(body, sign(body));
		expect(event.type).toBe("interrupt.escalated");
	});
});
