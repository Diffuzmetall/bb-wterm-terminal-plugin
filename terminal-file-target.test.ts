import { describe, expect, it } from "vitest";
import type { TerminalLinkAction } from "./terminal-links.js";
import {
	terminalFileOpen,
	workspaceRelativePath,
	type TerminalFileSource,
} from "./terminal-file-target.js";

const SOURCE: TerminalFileSource = {
	environmentId: "env_1",
	rootPath: "/home/ubuntu/Projects/app",
	hostId: "host_1",
};

function fileAction(
	overrides: Partial<Extract<TerminalLinkAction, { kind: "file" }>> = {},
): Extract<TerminalLinkAction, { kind: "file" }> {
	return {
		kind: "file",
		path: "/home/ubuntu/Projects/app/src/app.ts",
		absolute: true,
		line: null,
		column: null,
		...overrides,
	};
}

describe("workspaceRelativePath", () => {
	it("returns the path inside the root", () => {
		expect(
			workspaceRelativePath("/home/ubuntu/app", "/home/ubuntu/app/src/x.ts"),
		).toBe("src/x.ts");
	});

	it("rejects paths outside, equal to, or escaping the root", () => {
		expect(workspaceRelativePath("/home/ubuntu/app", "/home/ubuntu/other/x.ts")).toBeNull();
		expect(workspaceRelativePath("/home/ubuntu/app", "/home/ubuntu/app")).toBeNull();
		expect(
			workspaceRelativePath("/home/ubuntu/app", "/home/ubuntu/app/../secret.md"),
		).toBeNull();
	});
});

describe("terminalFileOpen", () => {
	it("opens a workspace file with the location it was printed at", () => {
		expect(
			terminalFileOpen({
				action: fileAction({ path: "/home/ubuntu/Projects/app/src/app.ts", line: 12, column: 3 }),
				source: SOURCE,
				initialCwd: null,
				hostId: "host_1",
			}),
		).toEqual({
			target: {
				kind: "workspace",
				environmentId: "env_1",
				path: "src/app.ts",
			},
			location: { kind: "line", line: 12, column: 3 },
		});
	});

	it("resolves a relative path against the terminal's own directory", () => {
		expect(
			terminalFileOpen({
				action: fileAction({
					path: "src/app.ts",
					absolute: false,
				}),
				source: SOURCE,
				initialCwd: "/home/ubuntu/Projects/app/packages/web",
				hostId: "host_1",
			}),
		).toEqual({
			target: {
				kind: "workspace",
				environmentId: "env_1",
				path: "packages/web/src/app.ts",
			},
			location: null,
		});
	});

	it("falls back to a host target outside the workspace", () => {
		expect(
			terminalFileOpen({
				action: fileAction({ path: "/etc/hosts" }),
				source: SOURCE,
				initialCwd: null,
				hostId: "host_1",
			}),
		).toEqual({
			target: { kind: "host", hostId: "host_1", path: "/etc/hosts" },
			location: null,
		});
	});

	it("still opens an absolute path when the thread has no workspace", () => {
		expect(
			terminalFileOpen({
				action: fileAction({ path: "/tmp/report.md" }),
				source: null,
				initialCwd: null,
				hostId: "host_1",
			}),
		).toEqual({
			target: { kind: "host", hostId: "host_1", path: "/tmp/report.md" },
			location: null,
		});
	});

	it("refuses to guess a relative path without a workspace", () => {
		expect(
			terminalFileOpen({
				action: fileAction({ path: "src/app.ts", absolute: false }),
				source: null,
				initialCwd: "/home/ubuntu/Projects/app",
				hostId: "host_1",
			}),
		).toBeNull();
	});
});
