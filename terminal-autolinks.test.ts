import { describe, expect, it } from "vitest";
import {
	continuesTerminalRow,
	isPartialAutoLink,
	planTerminalAutoLinks,
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
		expect(
			scanTerminalAutoLinks("see ~/Projects/app/src/main.ts for it"),
		).toEqual([]);
		expect(scanTerminalAutoLinks("~/notes.md")).toEqual([]);
	});

	it("still links an equivalent workspace-relative path", () => {
		expect(
			scanTerminalAutoLinks("see Projects/app/src/main.ts").map((l) => l.kind),
		).toEqual(["file"]);
	});
});

/** Rows as the renderer produces them: full width, padded with spaces. */
function renderedRows(line: string, width: number): string[] {
	const rows: string[] = [];
	for (let index = 0; index < line.length; index += width) {
		rows.push(line.slice(index, index + width).padEnd(width, " "));
	}
	return rows;
}

describe("continuesTerminalRow", () => {
	it("reads a wrap only from a full row and a mid-token start", () => {
		expect(continuesTerminalRow(["a".repeat(10), "more"], 1)).toBe(true);
		expect(continuesTerminalRow(["short     ", "more"], 1)).toBe(false);
		expect(continuesTerminalRow(["a".repeat(10), "  indented"], 1)).toBe(false);
		expect(continuesTerminalRow(["a".repeat(10)], 0)).toBe(false);
	});
});

describe("planTerminalAutoLinks", () => {
	it("stitches a path a wrap split across two rows", () => {
		const path =
			"/home/ubuntu/Projects/bb-wterm-terminal-plugin/terminal-autolinks.ts";
		const rows = renderedRows(path, 40);
		expect(rows).toHaveLength(2);
		const placements = planTerminalAutoLinks(rows);
		expect(placements.map((p) => [p.rowIndex, p.start, p.end])).toEqual([
			[0, 0, 40],
			[1, 0, path.length - 40],
		]);
		for (const placement of placements) {
			expect(placement.link).toMatchObject({
				kind: "file",
				path,
				absolute: true,
			});
		}
	});

	it("stitches a URL a wrap split across three rows", () => {
		const url = `${ORIGIN}/${["a", "longer", "and", "longer", "still", "index.md"].join("/")}`;
		const rows = renderedRows(url, 22);
		expect(rows.length).toBeGreaterThanOrEqual(3);
		const placements = planTerminalAutoLinks(rows);
		expect(placements).toHaveLength(rows.length);
		for (const placement of placements) {
			expect(placement.link).toMatchObject({ kind: "url", url });
		}
	});

	it("stitches a path whose wrap lands on a slash", () => {
		const path =
			"/home/ubuntu/Projects/bb-wterm-terminal-plugin/terminal-autolinks.ts";
		const split = path.indexOf("/bb-wterm");
		const prefix = "x".repeat(52 - 1 - split);
		const rows = [
			`${prefix} ${path.slice(0, split)}`,
			`${path.slice(split)}`.padEnd(52, " "),
		];
		expect(rows[0]).toHaveLength(52);
		expect(rows[1]?.startsWith("/")).toBe(true);
		const placements = planTerminalAutoLinks(rows);
		expect(placements.map((p) => [p.rowIndex, p.start, p.end])).toEqual([
			[0, prefix.length + 1, 52],
			[1, 0, path.length - split],
		]);
		for (const placement of placements) {
			expect(placement.link).toMatchObject({ kind: "file", path });
		}
	});

	it("leaves a wrapped fragment as text until its row arrives", () => {
		const path =
			"/home/ubuntu/Projects/bb-wterm-terminal-plugin/terminal-autolinks.ts";
		const [firstRow] = renderedRows(path, 40);
		expect(planTerminalAutoLinks([firstRow ?? ""])).toEqual([]);
		expect(planTerminalAutoLinks(renderedRows(path, 40))).toHaveLength(2);
	});

	it("keeps a line and column that a wrap pushed to the next row", () => {
		const path =
			"/home/ubuntu/Projects/bb-wterm-terminal-plugin/terminal-autolink-dom.ts";
		const rows = renderedRows(`${path}:42:7`, 44);
		expect(rows).toHaveLength(2);
		const placements = planTerminalAutoLinks(rows);
		expect(placements).toHaveLength(2);
		const [first, second] = placements;
		expect(first?.link).toMatchObject({ path, line: 42, column: 7 });
		expect(second?.link).toMatchObject({ path, line: 42, column: 7 });
	});

	it("links rows that are separate lines, not one wrap", () => {
		const rows = [
			"docs/portability.md".padEnd(30, " "),
			"/tmp/report.ts".padEnd(30, " "),
		];
		const placements = planTerminalAutoLinks(rows);
		expect(placements.map((p) => [p.rowIndex, p.start, p.end])).toEqual([
			[0, 0, "docs/portability.md".length],
			[1, 0, "/tmp/report.ts".length],
		]);
		expect(placements[0]?.link).toMatchObject({ path: "docs/portability.md" });
		expect(placements[1]?.link).toMatchObject({ path: "/tmp/report.ts" });
	});

	it("splits two links on one row without nesting them", () => {
		const text = "a src/app.ts and /tmp/b.md";
		const placements = planTerminalAutoLinks([text.padEnd(40, " ")]);
		expect(placements).toHaveLength(2);
		const [first, second] = placements;
		if (!first || !second) throw new Error("expected two placements");
		expect(first.end).toBeLessThanOrEqual(second.start);
		expect(text.slice(first.start, first.end)).toBe("src/app.ts");
		expect(text.slice(second.start, second.end)).toBe("/tmp/b.md");
	});

	it("returns nothing for rows without links", () => {
		expect(planTerminalAutoLinks([])).toEqual([]);
		expect(planTerminalAutoLinks(["plain output".padEnd(20, " ")])).toEqual([]);
	});
});
