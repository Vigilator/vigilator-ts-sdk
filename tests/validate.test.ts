import { describe, expect, it } from "vitest";
import { type Message, ValidationError } from "../src";
import {
	validateAppendMessages,
	validateInterruptCreateParams,
	validateSessionStart,
} from "../src/validate";
import { INTERRUPT, PROMPT } from "./helpers";

function issuesOf(run: () => void): string[] {
	try {
		run();
	} catch (error) {
		if (error instanceof ValidationError) {
			return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
		}
		throw error;
	}
	return [];
}

describe("validateInterruptCreateParams", () => {
	it("accepts a minimal interrupt", () => {
		expect(() => validateInterruptCreateParams(INTERRUPT)).not.toThrow();
	});

	it("reports every contract violation at once", () => {
		const issues = issuesOf(() =>
			validateInterruptCreateParams({
				title: "x",
				description: " ",
				externalId: "",
				actionRequests: [{ name: "", allowedDecisions: [], description: "" }],
			}),
		);

		expect(issues).toEqual([
			"title: must be at least 2 characters",
			"description: must be at least 2 characters",
			"externalId: must not be empty",
			"actionRequests.0.name: must not be empty",
			"actionRequests.0.description: must not be empty",
			"actionRequests.0.allowedDecisions: must contain at least one decision",
		]);
	});

	it("enforces the upper bounds", () => {
		const issues = issuesOf(() =>
			validateInterruptCreateParams({
				title: "t".repeat(101),
				description: "d".repeat(2001),
				actionRequests: Array.from({ length: 51 }, () => ({
					name: "n".repeat(101),
					allowedDecisions: ["approve"],
				})),
				messages: Array.from({ length: 201 }, () => PROMPT),
			}),
		);

		expect(issues).toContain("title: must not exceed 100 characters");
		expect(issues).toContain("description: must not exceed 2000 characters");
		expect(issues).toContain(
			"actionRequests: must not contain more than 50 action requests",
		);
		expect(issues).toContain(
			"actionRequests.0.name: must not exceed 100 characters",
		);
		expect(issues).toContain(
			"messages: must not contain more than 200 messages",
		);
	});
});

describe("message rules", () => {
	it("requires a toolCallId on tool messages", () => {
		const message: Message = { type: "tool", content: "{}", name: "lookup" };
		expect(issuesOf(() => validateAppendMessages([message]))).toEqual([
			"messages.0.toolCallId: tool messages must carry the toolCallId they answer",
		]);
	});

	it("forbids tool calls on tool messages", () => {
		const message: Message = {
			type: "tool",
			content: "{}",
			toolCallId: "call_1",
			toolCalls: [],
		};
		expect(issuesOf(() => validateAppendMessages([message]))).toEqual([
			"messages.0.toolCalls: tool messages cannot make tool calls",
		]);
	});

	it("forbids toolCallId and toolStatus on human and ai messages", () => {
		const message: Message = {
			type: "ai",
			content: "done",
			toolStatus: "success",
		};
		expect(issuesOf(() => validateAppendMessages([message]))).toEqual([
			"messages.0.toolCallId: toolCallId and toolStatus are only valid on tool messages",
		]);
	});

	it("rejects empty names", () => {
		const message: Message = { type: "human", content: "hi", name: " " };
		expect(issuesOf(() => validateAppendMessages([message]))).toEqual([
			"messages.0.name: must not be empty",
		]);
	});
});

describe("validateSessionStart", () => {
	it("checks the name and the opening context", () => {
		expect(issuesOf(() => validateSessionStart("", {}))).toEqual([
			"name: must not be empty",
		]);
		expect(issuesOf(() => validateSessionStart("n".repeat(101), {}))).toEqual([
			"name: must not exceed 100 characters",
		]);
		expect(
			issuesOf(() =>
				validateSessionStart("agent", { externalId: " ", messages: [] }),
			),
		).toEqual(["externalId: must not be empty"]);
		expect(() =>
			validateSessionStart("agent", { messages: [PROMPT] }),
		).not.toThrow();
	});
});

describe("validateAppendMessages", () => {
	it("requires between 1 and 200 messages", () => {
		expect(issuesOf(() => validateAppendMessages([]))).toEqual([
			"messages: must contain at least 1 message",
		]);
		expect(
			issuesOf(() =>
				validateAppendMessages(Array.from({ length: 201 }, () => PROMPT)),
			),
		).toEqual(["messages: must not contain more than 200 messages"]);
	});
});
