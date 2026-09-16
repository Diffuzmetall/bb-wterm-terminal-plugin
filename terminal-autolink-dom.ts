import {
	isPartialAutoLink,
	scanTerminalAutoLinks,
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
 * and only over rows whose text still contains a link-shaped token.
 */

const LINKABLE_TEXT = /https?:\/\/|\/|\.\w{1,10}\b/u;
const LINK_CLASS = "term-link";
const AUTO_ATTRIBUTE = "data-wterm-autolink";
const FRAME_BUDGET_MS = 4;

function isInsideLink(node: Node): boolean {
	const parent = node.parentElement;
	return parent !== null && parent.closest(`a.${LINK_CLASS}`) !== null;
}

function replaceNodeWithLinks(
	node: Text,
	boundaries: { wrapped: boolean; continues: boolean },
): void {
	const parent = node.parentNode;
	if (parent === null) return;
	const links = scanTerminalAutoLinks(node.data);
	if (links.length === 0) return;
	const fragment = node.ownerDocument.createDocumentFragment();
	let cursor = 0;
	for (const link of links) {
		if (isPartialAutoLink(link, node.data, boundaries)) continue;
		const href = terminalAutoLinkHref(link);
		if (href.length === 0) continue;
		if (link.start > cursor) {
			fragment.append(
				node.ownerDocument.createTextNode(node.data.slice(cursor, link.start)),
			);
		}
		const anchor = node.ownerDocument.createElement("a");
		anchor.className = LINK_CLASS;
		anchor.setAttribute(AUTO_ATTRIBUTE, "true");
		anchor.href = href;
		anchor.target = "_blank";
		anchor.rel = "noopener noreferrer";
		anchor.textContent = node.data.slice(link.start, link.end);
		fragment.append(anchor);
		cursor = link.end;
	}
	if (cursor === 0) return;
	if (cursor < node.data.length) {
		fragment.append(node.ownerDocument.createTextNode(node.data.slice(cursor)));
	}
	parent.replaceChild(fragment, node);
}

function linkifyRow(row: Element, previousRowWrapped: boolean): boolean {
	const text = row.textContent ?? "";
	const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node instanceof Text && !isInsideLink(node)) nodes.push(node);
	}
	if (nodes.length === 0) return false;
	const wrapped = text.length > 0 && !/\s$/u.test(text);
	const continues = previousRowWrapped && text.length > 0 && !/^\s/u.test(text);
	for (const [index, node] of nodes.entries()) {
		if (!LINKABLE_TEXT.test(node.data)) continue;
		replaceNodeWithLinks(node, {
			continues: continues && index === 0,
			wrapped: wrapped && index === nodes.length - 1,
		});
	}
	return wrapped;
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
		let previousRowWrapped = false;
		for (const row of element.querySelectorAll(rowSelector)) {
			if (LINKABLE_TEXT.test(row.textContent ?? "")) {
				previousRowWrapped = linkifyRow(row, previousRowWrapped);
			} else {
				previousRowWrapped = false;
			}
			// A long scrollback must not delay the frame that paints it.
			if ((scheduleTarget.performance?.now() ?? 0) - started > FRAME_BUDGET_MS) {
				schedule();
				return;
			}
		}
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
