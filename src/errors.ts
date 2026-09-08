/**
 * Errors thrown by the Vigilator SDK.
 *
 * Every error extends {@link VigilatorError}, so `catch (error) { if (error
 * instanceof VigilatorError) ... }` covers the whole SDK. API errors carry the
 * HTTP status and the machine-readable `code` from the response body; the
 * quota and not-found codes have dedicated subclasses so they can be caught
 * individually.
 */

/** Base class for all errors raised by the Vigilator SDK. */
export class VigilatorError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "VigilatorError";
	}
}

/** The API could not be reached: network failure, DNS error, timeout, etc. */
export class VigilatorConnectionError extends VigilatorError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "VigilatorConnectionError";
	}
}

/**
 * A webhook delivery could not be verified.
 *
 * Covers a malformed signing secret, missing or malformed Svix headers, a
 * timestamp outside the accepted tolerance, a signature mismatch, and a
 * verified body that is not valid JSON.
 */
export class WebhookVerificationError extends VigilatorError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "WebhookVerificationError";
	}
}

/** One violation of the API contract found before a request was sent. */
export interface ValidationIssue {
	/** Dot path of the offending field, e.g. `"messages.1.toolCallId"`. */
	readonly path: string;
	readonly message: string;
}

/**
 * The input breaks the API contract, so no request was sent.
 *
 * Raised for the checks the API would reject anyway - an empty session name,
 * an empty message batch, more than 200 messages - so problems surface with a
 * clear message instead of a 400 from the server.
 */
export class ValidationError extends VigilatorError {
	readonly issues: readonly ValidationIssue[];

	constructor(issues: readonly ValidationIssue[]) {
		super(
			`Invalid input: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
		);
		this.name = "ValidationError";
		this.issues = issues;
	}
}

/**
 * The API responded with an error status code.
 *
 * `message` is the human-readable message returned by the API; `code` is its
 * machine-readable counterpart (e.g. `"NOT_FOUND"`, `"CONFLICT"`), `status`
 * the HTTP status and `data` any structured details the API attached.
 */
export class APIError extends VigilatorError {
	/** HTTP status code of the response. */
	readonly status: number;
	/** Machine-readable error code returned by the API; `"UNKNOWN"` when the body carried none. */
	readonly code: string;
	/** Additional structured error details, if any. */
	readonly data: unknown;

	constructor(status: number, code: string, message: string, data?: unknown) {
		super(message);
		this.name = "APIError";
		this.status = status;
		this.code = code;
		this.data = data;
	}
}

/** 402 `USAGE_LIMIT_REACHED`: the organisation's usage quota is exhausted. */
export class UsageLimitError extends APIError {
	constructor(status: number, code: string, message: string, data?: unknown) {
		super(status, code, message, data);
		this.name = "UsageLimitError";
	}
}

/** 402 `PLAN_REQUIRED`: the feature requires a paid plan. */
export class PlanRequiredError extends APIError {
	constructor(status: number, code: string, message: string, data?: unknown) {
		super(status, code, message, data);
		this.name = "PlanRequiredError";
	}
}

/** 402 `ADDON_REQUIRED`: the feature requires an add-on. */
export class AddonRequiredError extends APIError {
	constructor(status: number, code: string, message: string, data?: unknown) {
		super(status, code, message, data);
		this.name = "AddonRequiredError";
	}
}

/** 403 `WORKSPACE_LIMIT_REACHED` / `ORGANISATION_LIMIT_REACHED`: the workspace limit has been reached. */
export class WorkspaceLimitError extends APIError {
	constructor(status: number, code: string, message: string, data?: unknown) {
		super(status, code, message, data);
		this.name = "WorkspaceLimitError";
	}
}

/** 404 `NOT_FOUND`: the requested resource does not exist. */
export class NotFoundError extends APIError {
	constructor(status: number, code: string, message: string, data?: unknown) {
		super(status, code, message, data);
		this.name = "NotFoundError";
	}
}

type APIErrorClass = new (
	status: number,
	code: string,
	message: string,
	data?: unknown,
) => APIError;

/** The API error codes that map onto a dedicated subclass. */
export const ERROR_CLASSES: Readonly<Record<string, APIErrorClass>> = {
	USAGE_LIMIT_REACHED: UsageLimitError,
	PLAN_REQUIRED: PlanRequiredError,
	ADDON_REQUIRED: AddonRequiredError,
	WORKSPACE_LIMIT_REACHED: WorkspaceLimitError,
	ORGANISATION_LIMIT_REACHED: WorkspaceLimitError,
	NOT_FOUND: NotFoundError,
};
