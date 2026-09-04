import { describe, expect, it, vi } from "vitest";
import {
	initialPanelParams,
	resolveSessionTerminalId,
	revealSessionTerminalPanel,
} from "./session-terminal-composer.js";

describe("initialPanelParams", () => {
	it("uses host params and ignores a stored last id", () => {
		expect(
			initialPanelParams({ schemaVersion: 1, terminalId: "term-host" }),
		).toEqual({ schemaVersion: 1, terminalId: "term-host" });
		expect(initialPanelParams(null)).toBeNull();
		expect(initialPanelParams(undefined)).toBeNull();
		expect(initialPanelParams({ schemaVersion: 1, terminalId: "" })).toBeNull();
	});
});

describe("resolveSessionTerminalId", () => {
	it("reuses the last live terminal when no Wterm tab is open", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => [
					{ id: "term-1", status: "running" },
					{ id: "term-2", status: "exited" },
				],
				openTabCount: 0,
			}),
		).resolves.toBe("term-1");
		expect(createTerminalId).not.toHaveBeenCalled();
	});

	it("creates a terminal when another Wterm tab is already open", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => [{ id: "term-1", status: "running" }],
				openTabCount: 1,
			}),
		).resolves.toBe("term-new");
		expect(createTerminalId).toHaveBeenCalledOnce();
	});

	it("creates a terminal when the last session is gone", async () => {
		await expect(
			resolveSessionTerminalId({
				createTerminalId: async () => "term-new",
				lastTerminalId: "term-dead",
				listCandidates: async () => [{ id: "term-other", status: "running" }],
				openTabCount: 0,
			}),
		).resolves.toBe("term-new");
	});

	it("keeps the last terminal when listing sessions fails and no tab is open", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => {
					throw new Error("offline");
				},
				openTabCount: 0,
			}),
		).resolves.toBe("term-1");
		expect(createTerminalId).not.toHaveBeenCalled();
	});

	it("creates when listing sessions fails while a tab is already opening", async () => {
		const createTerminalId = vi.fn(async () => "term-new");

		await expect(
			resolveSessionTerminalId({
				createTerminalId,
				lastTerminalId: "term-1",
				listCandidates: async () => {
					throw new Error("offline");
				},
				openTabCount: 1,
			}),
		).resolves.toBe("term-new");
		expect(createTerminalId).toHaveBeenCalledOnce();
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
