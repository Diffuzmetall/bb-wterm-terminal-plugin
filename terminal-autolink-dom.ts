import {
	continuesTerminalRow,
	planTerminalAutoLinks,
	type TerminalAutoLinkPlacement,
} from "./terminal-autolinks.js";
import { terminalAutoLinkHref } from "./terminal-links.js";

/**
 * Make bare URLs and file paths in rendered terminal rows clickable.
 *
 * Programs only send OSC 8 when they recognize the terminal, and most TUIs in
 * a BB terminal decide they do not — so the common case is plain text. This
 * pass adds the same `.term-link` anchors the OSC 8 path produces, which keeps
 * one click handler for both.
 *
 * It runs at most once per animation frame, only while rows actually change,
 * and only over rows whose text still contains a link-shaped token. A link a
 * terminal wrap split across two rows becomes one anchor per row, both
 * pointing at the stitched target.
 */

const LINK_CLASS = "term-link";
const AUTO_ATTRIBUTE = "data-wterm-autolink";
const FRAME_BUDGET_MS = 4;

/** One stretch of a row that becomes an anchor. */
interface LinkPiece {
	start: number;
	end: number;
	href: string;
}

function isInsideLink(node: Node): boolean {
	const parent = node.parentElement;
	return parent !== null && parent.closest(`a.${LINK_CLASS}`) !== null;
}

/**
 * The text nodes of a row that can still be linked, in document order.
 * Text inside an existing anchor is left alone so anchors never nest.
 */
function rowTextNodes(row: Element): Text[] {
	const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node instanceof Text && !isInsideLink(node)) nodes.push(node);
	}
	return nodes;
}

function piecesForRow(
	rowText: string,
	placements: TerminalAutoLinkPlacement[],
): LinkPiece[] {
	const pieces: LinkPiece[] = [];
	for (const placement of placements) {
		const href = terminalAutoLinkHref(placement.link);
		if (href.length === 0) continue;
		const start = Math.max(0, Math.min(placement.start, rowText.length));
		const end = Math.max(start, Math.min(placement.end, rowText.length));
		if (end <= start) continue;
		const previous = pieces.at(-1);
		if (previous !== undefined && start < previous.end) continue;
		pieces.push({ start, end, href });
	}
	return pieces;
}

/** Replace one text node with its plain parts and the anchor pieces inside it. */
function replaceNodeText(
	node: Text,
	nodeStart: number,
	pieces: LinkPiece[],
): void {
	const parent = node.parentNode;
	if (parent === null) return;
	const document = node.ownerDocument;
	const fragment = document.createDocumentFragment();
	let cursor = 0;
	for (const piece of pieces) {
		const from = Math.max(piece.start - nodeStart, 0);
		const to = Math.min(piece.end - nodeStart, node.data.length);
		if (to <= from) continue;
		if (from > cursor) {
			fragment.append(document.createTextNode(node.data.slice(cursor, from)));
		}
		const anchor = document.createElement("a");
		anchor.className = LINK_CLASS;
		anchor.setAttribute(AUTO_ATTRIBUTE, "true");
		anchor.href = piece.href;
		anchor.target = "_blank";
		anchor.rel = "noopener noreferrer";
		anchor.textContent = node.data.slice(from, to);
		fragment.append(anchor);
		cursor = to;
	}
	if (cursor < node.data.length) {
		fragment.append(document.createTextNode(node.data.slice(cursor)));
	}
	parent.replaceChild(fragment, node);
}

function linkifyRow(
	row: Element,
	placements: TerminalAutoLinkPlacement[],
	rowText: string,
): void {
	const nodes = rowTextNodes(row);
	if (nodes.length === 0) return;
	const pieces = piecesForRow(rowText, placements);
	if (pieces.length === 0) return;
	let nodeStart = 0;
	for (const node of nodes) {
		const nodeEnd = nodeStart + node.data.length;
		const overlapping = pieces.filter(
			(piece) => piece.end > nodeStart && piece.start < nodeEnd,
		);
		if (overlapping.length > 0) replaceNodeText(node, nodeStart, overlapping);
		nodeStart = nodeEnd;
	}
}

/**
 * The text a row can still be linked in.
 *
 * An anchor of ours, or one the renderer built from OSC 8, splits the row,
 * and everything inside it is already a link — so the offsets used to plan
 * links have to come from the same text the anchors are applied to. Reading
 * `textContent` on a row that already holds an anchor would count that text
 * twice and place later anchors over the wrong characters.
 */
function rowLinkText(row: Element, nodes: Text[]): string {
	if (row.querySelector(`a.${LINK_CLASS}`) === null)
		return row.textContent ?? "";
	return nodes.map((node) => node.data).join("");
}

/**
 * Observe one rendered terminal element and linkify rows as they change.
 * Returns a disposer that stops the observer and any pending frame.
 */
export function attachTerminalAutoLinks(element: Element): () => void {
	const rowSelector = ".term-row";
	const scheduleTarget = element.ownerDocument.defaultView;
	if (scheduleTarget === null) return () => undefined;

	let frame: number | null = null;
	let disposed = false;

	const run = () => {
		frame = null;
		if (disposed) return;
		const started = scheduleTarget.performance?.now() ?? 0;
		const elapsed = () => (scheduleTarget.performance?.now() ?? 0) - started;
		const rows = [...element.querySelectorAll(rowSelector)];
		if (rows.length === 0) return;

		const texts: string[] = [];
		for (const row of rows) {
			texts.push(rowLinkText(row, rowTextNodes(row)));
			if (elapsed() > FRAME_BUDGET_MS) break;
		}
		// A wrapped row is only readable together with the row its text runs
		// onto, so a long scrollback is cut at a line boundary, never inside
		// one.
		while (
			texts.length < rows.length &&
			continuesTerminalRow(texts, texts.length)
		) {
			const row = rows[texts.length];
			if (row === undefined) break;
			texts.push(rowLinkText(row, rowTextNodes(row)));
		}

		const byRow = new Map<number, TerminalAutoLinkPlacement[]>();
		for (const placement of planTerminalAutoLinks(texts)) {
			const placed = byRow.get(placement.rowIndex);
			if (placed === undefined) byRow.set(placement.rowIndex, [placement]);
			else placed.push(placement);
		}
		for (const [rowIndex, placements] of byRow) {
			// No cheap text filter here: the half of a wrapped link that carries
			// a row's first characters (`l` of `…html`) looks like nothing on its
			// own, and the plan has already decided what belongs to this row.
			const row = rows[rowIndex];
			if (row === undefined) continue;
			linkifyRow(row, placements, texts[rowIndex] ?? "");
		}

		if (texts.length < rows.length) schedule();
	};

	const schedule = () => {
		if (disposed || frame !== null) return;
		frame = scheduleTarget.requestAnimationFrame(run);
	};

	const observer = new MutationObserver(schedule);
	observer.observe(element, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	schedule();

	return () => {
		disposed = true;
		observer.disconnect();
		if (frame !== null) scheduleTarget.cancelAnimationFrame(frame);
	};
}

/** Wait for the renderer to publish its row container, then attach. */
export function attachTerminalAutoLinksWhenReady(
	element: () => Element | null,
): () => void {
	const view = element()?.ownerDocument.defaultView ?? null;
	let frame: number | null = null;
	let disposer: (() => void) | null = null;
	let attempts = 0;

	const attempt = () => {
		frame = null;
		if (disposer !== null) return;
		const target = element();
		if (target !== null) {
			disposer = attachTerminalAutoLinks(target);
			return;
		}
		attempts += 1;
		if (attempts > 120 || view === null) return;
		frame = view.requestAnimationFrame(attempt);
	};

	if (view === null) return () => undefined;
	frame = view.requestAnimationFrame(attempt);

	return () => {
		if (frame !== null) view.cancelAnimationFrame(frame);
		disposer?.();
		disposer = null;
	};
}
