/**
 * Client-side checks of the API contract, run before a request is sent.
 *
 * They mirror the server's input schemas so that input the API would reject
 * anyway fails fast with a clear {@link ValidationError} instead of a 400.
 * Only the limits the API enforces are checked; the type system covers the
 * rest.
 */

import { ValidationError, type ValidationIssue } from "./errors";
import type {
	ActionRequest,
	InterruptCreateParams,
	Message,
	SessionStartOptions,
} from "./types";

export const MAX_MESSAGES = 200;
export const MAX_ACTION_REQUESTS = 50;

class Issues {
	readonly list: ValidationIssue[] = [];

	add(path: string, message: string): void {
		this.list.push({ path, message });
	}

	throwIfAny(): void {
		if (this.list.length > 0) throw new ValidationError(this.list);
	}
}

function checkLength(
	issues: Issues,
	path: string,
	value: string,
	min: number,
	max: number,
): void {
	const length = value.trim().length;
	if (length < min) {
		issues.add(
			path,
			min === 1 ? "must not be empty" : `must be at least ${min} characters`,
		);
	} else if (length > max) {
		issues.add(path, `must not exceed ${max} characters`);
	}
}

function checkOptionalNonEmpty(
	issues: Issues,
	path: string,
	value: string | undefined,
): void {
	if (value !== undefined && value.trim().length === 0) {
		issues.add(path, "must not be empty");
	}
}

function checkMessage(issues: Issues, path: string, message: Message): void {
	checkOptionalNonEmpty(issues, `${path}.name`, message.name);
	checkOptionalNonEmpty(issues, `${path}.toolCallId`, message.toolCallId);
	if (message.type === "tool") {
		if (message.toolCallId === undefined) {
			issues.add(
				`${path}.toolCallId`,
				"tool messages must carry the toolCallId they answer",
			);
		}
		if (
			message.toolCalls !== undefined ||
			message.invalidToolCalls !== undefined
		) {
			issues.add(`${path}.toolCalls`, "tool messages cannot make tool calls");
		}
		return;
	}
	if (message.toolCallId !== undefined || message.toolStatus !== undefined) {
		issues.add(
			`${path}.toolCallId`,
			"toolCallId and toolStatus are only valid on tool messages",
		);
	}
}

function checkMessages(
	issues: Issues,
	path: string,
	messages: readonly Message[] | undefined,
	min: number,
): void {
	if (messages === undefined) {
		if (min > 0) issues.add(path, "is required");
		return;
	}
	if (messages.length < min) {
		issues.add(
			path,
			`must contain at least ${min} message${min === 1 ? "" : "s"}`,
		);
	} else if (messages.length > MAX_MESSAGES) {
		issues.add(path, `must not contain more than ${MAX_MESSAGES} messages`);
	}
	messages.forEach((message, index) => {
		checkMessage(issues, `${path}.${index}`, message);
	});
}

function checkActionRequest(
	issues: Issues,
	path: string,
	request: ActionRequest,
): void {
	checkLength(issues, `${path}.name`, request.name, 1, 100);
	if (request.description !== undefined) {
		checkLength(issues, `${path}.description`, request.description, 1, 2000);
	}
	if (request.allowedDecisions.length === 0) {
		issues.add(
			`${path}.allowedDecisions`,
			"must contain at least one decision",
		);
	}
}

/** Checks the body of `createInterrupt` against the API contract. */
export function validateInterruptCreateParams(
	params: InterruptCreateParams,
): void {
	const issues = new Issues();
	checkLength(issues, "title", params.title, 2, 100);
	checkLength(issues, "description", params.description, 2, 2000);
	checkOptionalNonEmpty(issues, "classificationId", params.classificationId);
	checkOptionalNonEmpty(issues, "externalId", params.externalId);
	checkMessages(issues, "messages", params.messages, 0);
	if (params.actionRequests.length === 0) {
		issues.add("actionRequests", "must contain at least one action request");
	} else if (params.actionRequests.length > MAX_ACTION_REQUESTS) {
		issues.add(
			"actionRequests",
			`must not contain more than ${MAX_ACTION_REQUESTS} action requests`,
		);
	}
	params.actionRequests.forEach((request, index) => {
		checkActionRequest(issues, `actionRequests.${index}`, request);
	});
	issues.throwIfAny();
}

/** Checks the arguments of `startSession` against the API contract. */
export function validateSessionStart(
	name: string,
	options: SessionStartOptions,
): void {
	const issues = new Issues();
	checkLength(issues, "name", name, 1, 100);
	checkOptionalNonEmpty(issues, "externalId", options.externalId);
	checkMessages(issues, "messages", options.messages, 0);
	issues.throwIfAny();
}

/** Checks the arguments of `appendSessionMessages` against the API contract. */
export function validateAppendMessages(messages: readonly Message[]): void {
	const issues = new Issues();
	checkMessages(issues, "messages", messages, 1);
	issues.throwIfAny();
}

/** Checks that a resource id is usable in a request path. */
export function validateId(path: string, id: string): void {
	if (typeof id !== "string" || id.length === 0) {
		throw new ValidationError([{ path, message: "must not be empty" }]);
	}
}
