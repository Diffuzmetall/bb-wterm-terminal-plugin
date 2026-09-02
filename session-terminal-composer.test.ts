import { describe, expect, it, vi } from "vitest";
import {
	resolveSessionTerminalId,
	revealSessionTerminalPanel,
} from "./session-terminal-composer.js";

describe("resolveSessionTerminalId", () => {
	it("reuses the last live terminal instead of creating another", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => [
					{ id: "term-1", status: "running" },
					{ id: "term-2", status: "exited" },
				],
			}),
		).resolves.toBe("term-1");
		expect(createTerminalId).not.toHaveBeenCalled();
	});

	it("creates a terminal when the last session is gone", async () => {
		await expect(
			resolveSessionTerminalId({
				createTerminalId: async () => "term-new",
				lastTerminalId: "term-dead",
				listCandidates: async () => [{ id: "term-other", status: "running" }],
			}),
		).resolves.toBe("term-new");
	});

	it("keeps the last terminal when listing sessions fails", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => {
					throw new Error("offline");
				},
			}),
		).resolves.toBe("term-1");
		expect(createTerminalId).not.toHaveBeenCalled();
	});
});

describe("revealSessionTerminalPanel", () => {
	it("opens the panel with a known terminal id", () => {
		const openThreadPanel = vi.fn(() => true);

		revealSessionTerminalPanel({
			actionId: "terminal",
			openThreadPanel,
			terminalId: "term-1",
			title: "Wterm terminal",
		});

		expect(openThreadPanel).toHaveBeenCalledWith({
			actionId: "terminal",
			experimental_primarySurface: true,
			params: { schemaVersion: 1, terminalId: "term-1" },
			title: "Wterm terminal",
		});
	});

	it("opens the picker when no terminal id is known", () => {
		const openThreadPanel = vi.fn(() => true);

		revealSessionTerminalPanel({
			actionId: "terminal",
			openThreadPanel,
			title: "Wterm terminal",
		});

		expect(openThreadPanel).toHaveBeenCalledWith({
			actionId: "terminal",
			experimental_primarySurface: true,
			title: "Wterm terminal",
		});
	});

	it("throws when the host rejects the panel open", () => {
		expect(() =>
			revealSessionTerminalPanel({
				actionId: "terminal",
				openThreadPanel: () => false,
				title: "Wterm terminal",
			}),
		).toThrow("This BB view could not switch to the session terminal.");
	});
});
