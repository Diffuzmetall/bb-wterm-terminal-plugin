import { describe, expect, it } from "vitest";
import { terminalLinkAction, terminalLinkHref } from "./terminal-links.js";

describe("terminalLinkHref", () => {
	it("keeps HTTP(S) links usable by the terminal DOM renderer", () => {
		expect(terminalLinkHref("https://example.com/a?q=1")).toBe(
			"https://example.com/a?q=1",
		);
	});

	it("turns absolute file URIs into an inert internal marker", () => {
		const href = terminalLinkHref("file:///workspace/src/app.ts");
		expect(href).toMatch(/^https:\/\/wterm\.invalid\/__bb_wterm_file__\?/u);
		expect(terminalLinkAction(href ?? "")).toEqual({
			kind: "file",
			path: "/workspace/src/app.ts",
		});
	});

	it("rejects unsafe schemes, relative files, and remote file hosts", () => {
		expect(terminalLinkHref("javascript:alert(1)")).toBeUndefined();
		expect(terminalLinkHref("file:relative.txt")).toBeUndefined();
		expect(terminalLinkHref("file://other-host/workspace/app.ts")).toBeUndefined();
	});
});

describe("terminalLinkAction", () => {
	it("returns normalized web URLs", () => {
		expect(terminalLinkAction("http://example.com")).toEqual({
			kind: "url",
			url: "http://example.com/",
		});
	});

	it("does not treat arbitrary marker URLs as files", () => {
		expect(
			terminalLinkAction("https://wterm.invalid/__bb_wterm_file__?uri=javascript%3Aalert(1)"),
		).toBeNull();
	});
});
