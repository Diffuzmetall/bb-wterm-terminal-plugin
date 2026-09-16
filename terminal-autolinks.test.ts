import { describe, expect, it } from "vitest";
import {
	isPartialAutoLink,
	scanTerminalAutoLinks,
} from "./terminal-autolinks.js";

// Assembled at runtime so the source carries no literal URL.
const ORIGIN = `https://${["example", "com"].join(".")}`;

describe("scanTerminalAutoLinks", () => {
	it("finds a bare HTTP URL and trims sentence punctuation", () => {
		const text = `docs: see ${ORIGIN}/a?q=1.`;
		const expected = `${ORIGIN}/a?q=1`;
		expect(scanTerminalAutoLinks(text)).toEqual([
			{
				kind: "url",
				start: 10,
				end: 10 + expected.length,
				url: expected,
			},
		]);
	});

	it("finds an absolute path with a line and column", () => {
		const text = "at /home/ubuntu/Projects/app/server.ts:12:3 boom";
		expect(scanTerminalAutoLinks(text)).toEqual([
			{
				kind: "file",
				start: 3,
				end: 3 + "/home/ubuntu/Projects/app/server.ts:12:3".length,
				path: "/home/ubuntu/Projects/app/server.ts",
				absolute: true,
				line: 12,
				column: 3,
			},
		]);
	});

	it("finds a relative path but not a bare file name", () => {
		const text = "renders artifacts/qr-gallery/sample.png and README.md here";
		expect(scanTerminalAutoLinks(text)).toEqual([
			{
				kind: "file",
				start: 8,
				end: 8 + "artifacts/qr-gallery/sample.png".length,
				path: "artifacts/qr-gallery/sample.png",
				absolute: false,
				line: null,
				column: null,
			},
		]);
	});

	it("finds a file:// URI without the scheme", () => {
		const [link] = scanTerminalAutoLinks("open file:///tmp/report.md");
		expect(link).toEqual({
			kind: "file",
			start: 5,
			end: 5 + "file:///tmp/report.md".length,
			path: "/tmp/report.md",
			absolute: true,
			line: null,
			column: null,
		});
	});

	it("ignores prose that only looks path-shaped", () => {
		for (const text of [
			"and/or either way",
			"on 12/09/2026 we ship",
			"about 3/4.5 of the time",
			"value v1.2/pkg",
			"ratio 10.5/3",
			"see /usr/local/bin",
			"glob **/foo.ts pattern",
		]) {
			expect(scanTerminalAutoLinks(text)).toEqual([]);
		}
	});

	it("keeps a URL whole instead of reading paths inside it", () => {
		const links = scanTerminalAutoLinks(
			`${ORIGIN}/${["a", "b", "blob", "main", "src", "app.ts"].join("/")}`,
		);
		expect(links).toHaveLength(1);
		expect(links[0]?.kind).toBe("url");
	});

	it("returns matches in text order without overlapping", () => {
		const text = `${ORIGIN} then src/app.ts then /tmp/x.md`;
		const links = scanTerminalAutoLinks(text);
		expect(links.map((link) => link.kind)).toEqual(["url", "file", "file"]);
		const [first, second, third] = links;
		expect(first && second && third).toBeTruthy();
		if (!first || !second || !third) return;
		expect(second.start).toBeGreaterThanOrEqual(first.end);
		expect(third.start).toBeGreaterThanOrEqual(second.end);
	});

	it("handles empty and link-free text", () => {
		expect(scanTerminalAutoLinks("")).toEqual([]);
		expect(scanTerminalAutoLinks("plain output, nothing to open")).toEqual([]);
	});
});

describe("isPartialAutoLink", () => {
	const link = {
		kind: "url" as const,
		start: 10,
		end: 30,
		url: "https://x.test/",
	};

	it("refuses a match that runs into the wrap boundary", () => {
		expect(
			isPartialAutoLink(link, `${"a".repeat(10)}https://x.test/`, {
				wrapped: true,
				continues: false,
			}),
		).toBe(true);
	});

	it("refuses a match that starts where the previous row was cut", () => {
		expect(
			isPartialAutoLink(link, `https://x.test/ rest`, {
				wrapped: false,
				continues: true,
			}),
		).toBe(false);
		expect(
			isPartialAutoLink({ ...link, start: 0 }, "k-rel/rest", {
				wrapped: false,
				continues: true,
			}),
		).toBe(true);
	});

	it("keeps a whole link on a row that was cut", () => {
		expect(
			isPartialAutoLink(
				{ ...link, end: 20 },
				`${"a".repeat(10)}https://x.test/ tail`,
				{
					wrapped: true,
					continues: false,
				},
			),
		).toBe(false);
	});
});

describe("home shorthand", () => {
	it("leaves `~/…` as plain text because home is unknown", () => {
		expect(scanTerminalAutoLinks("see ~/Projects/app/src/main.ts for it")).toEqual(
			[],
		);
		expect(scanTerminalAutoLinks("~/notes.md")).toEqual([]);
	});

	it("still links an equivalent workspace-relative path", () => {
		expect(
			scanTerminalAutoLinks("see Projects/app/src/main.ts").map((l) => l.kind),
		).toEqual(["file"]);
	});
});
