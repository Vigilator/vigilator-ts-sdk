/**
 * Vigilator TypeScript SDK.
 *
 * - {@link Client} opens interrupts, reads their outcome and streams Live
 *   View sessions.
 * - {@link WebhookHandler} verifies webhook deliveries and dispatches typed
 *   events.
 */

export {
	Client,
	type ClientOptions,
	DEFAULT_BACKOFF_FACTOR,
	DEFAULT_BASE_URL,
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT,
} from "./client";
export {
	AddonRequiredError,
	APIError,
	NotFoundError,
	PlanRequiredError,
	UsageLimitError,
	ValidationError,
	type ValidationIssue,
	VigilatorConnectionError,
	VigilatorError,
	WebhookVerificationError,
	WorkspaceLimitError,
} from "./errors";
export {
	type ActionRequest,
	AllowedDecision,
	type Assignee,
	type AuditEvent,
	type Classification,
	type DecidedActionRequest,
	Decision,
	type Interrupt,
	type InterruptCreateParams,
	type JsonObject,
	type JsonPrimitive,
	type JsonValue,
	type Message,
	MessageType,
	type operations,
	type paths,
	type Session,
	SessionEndReason,
	type SessionStartOptions,
	type SessionStartParams,
	SessionStatus,
	type StoredMessage,
	ToolStatus,
} from "./types";
export {
	type AnsweredActionRequest,
	type CreatedActionRequest,
	DEFAULT_TOLERANCE,
	type InterruptAnsweredData,
	type InterruptAnsweredEvent,
	type InterruptCreatedData,
	type InterruptCreatedEvent,
	type InterruptEscalatedData,
	type InterruptEscalatedEvent,
	type SessionActionData,
	type SessionActionEvent,
	type SessionEndedData,
	type SessionEndedEvent,
	type SessionEventData,
	type SessionStartedData,
	type SessionStartedEvent,
	type UnknownEvent,
	type WebhookBody,
	type WebhookCallback,
	type WebhookEnvelope,
	type WebhookEvent,
	type WebhookEventMap,
	type WebhookEventType,
	WebhookHandler,
	type WebhookHandlerOptions,
	type WebhookHeaders,
} from "./webhooks";
