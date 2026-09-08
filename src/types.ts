/**
 * Request and response types of the Vigilator API.
 *
 * The shapes come from `generated/api.d.ts`, which `bun run generate` derives
 * from the live OpenAPI spec; this module gives them stable, friendly names.
 * The enum-like values are exported both as a type (the union of literals)
 * and as a frozen object, so `Decision.approve` and `"approve"` are
 * interchangeable.
 */

import type { operations } from "./generated/api";

type JsonBody<T> = T extends { content: { "application/json": infer Body } }
	? Body
	: never;

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** A reviewer's decision on an action request. */
export const Decision = {
	approve: "approve",
	edit: "edit",
	reject: "reject",
	respond: "respond",
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

/** The decisions an action request offers its reviewer. */
export const AllowedDecision: typeof Decision = Decision;
export type AllowedDecision = Decision;

/** Who a message came from. */
export const MessageType = {
	human: "human",
	ai: "ai",
	tool: "tool",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Whether a tool result reports success or failure. */
export const ToolStatus = {
	success: "success",
	error: "error",
} as const;
export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

/** Lifecycle state of a Live View session. */
export const SessionStatus = {
	active: "active",
	ended: "ended",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Why a live session ended, as reported by the `session.ended` webhook event. */
export const SessionEndReason = {
	/** The agent ended the session itself (`Client.endSession`). */
	agent: "agent",
	/** The session went quiet past the organisation's session timeout and was closed automatically. */
	timeout: "timeout",
	/** A watcher disconnected the session from Live View. */
	manual: "manual",
	/** The organisation ran out of included monitored hours and every running session was closed. */
	limit: "limit",
} as const;
export type SessionEndReason =
	(typeof SessionEndReason)[keyof typeof SessionEndReason];

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

/** Body of `POST /api/interrupts`: what {@link Client.createInterrupt} takes. */
export type InterruptCreateParams = JsonBody<
	operations["interrupts.create"]["requestBody"]
>;

/**
 * One message in a conversation, in LangChain's shape with camelCase keys.
 *
 * `human` and `ai` turns are what was said; a `tool` message is the raw
 * result a tool returned, tied by `toolCallId` to an entry in the calling
 * `ai` message's `toolCalls`.
 */
export type Message = NonNullable<InterruptCreateParams["messages"]>[number];

/** An action the agent proposes and a reviewer decides on. */
export type ActionRequest = InterruptCreateParams["actionRequests"][number];

/** An interrupt as returned by the API, including decisions on its action requests. */
export type Interrupt = JsonBody<
	operations["interrupts.get"]["responses"][200]
>;

/** A message as stored by the API. */
export type StoredMessage = Interrupt["messages"][number];

/** An action request as stored by the API, with the reviewer's decision once taken. */
export type DecidedActionRequest = Interrupt["actionRequests"][number];

export type AuditEvent = Interrupt["auditEvents"][number];
export type Classification = NonNullable<Interrupt["classification"]>;
export type Assignee = NonNullable<Interrupt["assignee"]>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Body of `POST /api/sessions`. */
export type SessionStartParams = JsonBody<
	operations["live.start"]["requestBody"]
>;

/** The optional parts of {@link SessionStartParams}: what {@link Client.startSession} takes besides the name. */
export type SessionStartOptions = Omit<SessionStartParams, "name">;

/** A Live View session as returned by the API. */
export type Session = JsonBody<operations["live.start"]["responses"][200]>;

export type { operations, paths } from "./generated/api";
