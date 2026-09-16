import { describe, expect, it } from "vitest";
import {
	safeWebHref,
	terminalAutoLinkHref,
	terminalLinkAction,
	terminalLinkHref,
} from "./terminal-links.js";

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
			absolute: true,
			line: null,
			column: null,
		});
	});

	it("rejects unsafe schemes, relative files, and remote file hosts", () => {
		expect(terminalLinkHref("javascript:alert(1)")).toBeUndefined();
		expect(terminalLinkHref("file:relative.txt")).toBeUndefined();
		expect(terminalLinkHref("file://other-host/workspace/app.ts")).toBeUndefined();
	});
});

describe("terminalAutoLinkHref", () => {
	it("marks an absolute path as a file URI with a location", () => {
		expect(
			terminalLinkAction(
				terminalAutoLinkHref({
					kind: "file",
					start: 0,
					end: 10,
					path: "/tmp/report.md",
					absolute: true,
					line: 12,
					column: 3,
				}),
			),
		).toEqual({
			kind: "file",
			path: "/tmp/report.md",
			absolute: true,
			line: 12,
			column: 3,
		});
	});

	it("keeps a relative path relative", () => {
		expect(
			terminalLinkAction(
				terminalAutoLinkHref({
					kind: "file",
					start: 0,
					end: 10,
					path: "src/app.ts",
					absolute: false,
					line: null,
					column: null,
				}),
			),
		).toEqual({
			kind: "file",
			path: "src/app.ts",
			absolute: false,
			line: null,
			column: null,
		});
	});

	it("returns web URLs unchanged", () => {
		expect(
			terminalAutoLinkHref({
				kind: "url",
				start: 0,
				end: 5,
				url: "https://example.com/",
			}),
		).toBe("https://example.com/");
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

describe("safeWebHref", () => {
	it("returns the href of a web URL", () => {
		expect(safeWebHref("https://example.com/a?b=1")).toBe(
			"https://example.com/a?b=1",
		);
		expect(safeWebHref("http://example.com/")).toBe("http://example.com/");
	});

	it("refuses every other scheme and non-URL input", () => {
		expect(safeWebHref("javascript:alert(1)")).toBeNull();
		expect(safeWebHref("file:///etc/passwd")).toBeNull();
		expect(safeWebHref("data:text/html,<script>")).toBeNull();
		expect(safeWebHref("https://wterm.invalid/__bb_wterm_file__?uri=x")).toBe(
			"https://wterm.invalid/__bb_wterm_file__?uri=x",
		);
		expect(safeWebHref("/relative/path")).toBeNull();
		expect(safeWebHref("not a url")).toBeNull();
	});
});
