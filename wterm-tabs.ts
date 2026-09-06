export const MAX_WTERM_TAB_NAME_LENGTH = 64;

export type WtermTabPreference = {
  schemaVersion: 2;
  hostId: string;
  activeTerminalId: string;
  tabs: { id: string; name: string }[];
};

type Tab = { id: string; title?: string | null };

export function normalizeWtermTabName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_WTERM_TAB_NAME_LENGTH
    ? name
    : null;
}

export function parseWtermTabPreference(
  value: string | null,
): WtermTabPreference | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { hostId?: unknown }).hostId !== "string" ||
      typeof (parsed as { activeTerminalId?: unknown }).activeTerminalId !==
        "string"
    ) {
      return null;
    }
    const base = parsed as {
      schemaVersion?: unknown;
      hostId: string;
      activeTerminalId: string;
      tabs?: unknown;
    };
    if (base.schemaVersion === 1) {
      return { ...base, schemaVersion: 2, tabs: [] };
    }
    if (base.schemaVersion !== 2 || !Array.isArray(base.tabs)) return null;

    const tabs: { id: string; name: string }[] = [];
    const ids = new Set<string>();
    for (const tab of base.tabs) {
      if (
        typeof tab !== "object" ||
        tab === null ||
        typeof (tab as { id?: unknown }).id !== "string" ||
        typeof (tab as { name?: unknown }).name !== "string"
      ) {
        return null;
      }
      const { id, name } = tab as { id: string; name: string };
      const normalizedName = normalizeWtermTabName(name);
      if (!id || ids.has(id) || !normalizedName) return null;
      ids.add(id);
      tabs.push({ id, name: normalizedName });
    }
    return {
      schemaVersion: 2,
      hostId: base.hostId,
      activeTerminalId: base.activeTerminalId,
      tabs,
    };
  } catch {
    return null;
  }
}

export function createWtermTabPreference(
  tabs: readonly Tab[],
  hostId: string,
  activeTerminalId: string,
): WtermTabPreference {
  return {
    schemaVersion: 2,
    hostId,
    activeTerminalId,
    tabs: tabs.map((tab, index) => ({
      id: tab.id,
      name: normalizeWtermTabName(tab.title ?? "") ?? `Terminal ${index + 1}`,
    })),
  };
}

export function restoreWtermTabs<T extends Tab>(
  tabs: readonly T[],
  preference: WtermTabPreference | null,
  hostId: string,
): T[] {
  if (preference?.hostId !== hostId) return [...tabs];
  const current = new Map(tabs.map((tab) => [tab.id, tab]));
  const restored: T[] = [];
  for (const saved of preference.tabs) {
    const tab = current.get(saved.id);
    if (!tab) continue;
    restored.push({ ...tab, title: saved.name });
    current.delete(saved.id);
  }
  restored.push(...current.values());
  return restored;
}

export function reorderWtermTabs<T extends Tab>(
  tabs: readonly T[],
  movedId: string,
  targetId: string,
): readonly T[] {
  const from = tabs.findIndex(({ id }) => id === movedId);
  const to = tabs.findIndex(({ id }) => id === targetId);
  if (from < 0 || to < 0 || from === to) return tabs;
  const reordered = [...tabs];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return tabs;
  reordered.splice(to, 0, moved);
  return reordered;
}

export function activeWtermTabId(
  tabs: readonly Tab[],
  preference: WtermTabPreference | null,
  hostId: string,
): string | null {
  if (
    preference?.hostId === hostId &&
    tabs.some(({ id }) => id === preference.activeTerminalId)
  ) {
    return preference.activeTerminalId;
  }
  return tabs[0]?.id ?? null;
}

export function nextWtermTabIdAfterClose(
  tabs: readonly Tab[],
  closingId: string,
  activeId: string | null,
): string | null {
  if (activeId !== closingId && tabs.some(({ id }) => id === activeId)) {
    return activeId;
  }
  const closingIndex = tabs.findIndex(({ id }) => id === closingId);
  if (closingIndex < 0) return activeId;
  return tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? null;
}
