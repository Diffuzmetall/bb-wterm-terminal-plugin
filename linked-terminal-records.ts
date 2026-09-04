export interface LinkedTerminalRecord {
  id: string;
  firstUnavailableAt: number | null;
}

export const DEAD_TERMINAL_GRACE_MS = 60_000;

export function parseLinkedRecords(value: unknown): LinkedTerminalRecord[] {
  if (!Array.isArray(value)) return [];
  const records: LinkedTerminalRecord[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      records.push({ id: item, firstUnavailableAt: null });
      continue;
    }
    if (!item || typeof item !== "object" || !("id" in item)) continue;
    const id = (item as { id: unknown }).id;
    if (typeof id !== "string" || id.length === 0) continue;
    const stamp = (item as { firstUnavailableAt?: unknown }).firstUnavailableAt;
    records.push({
      id,
      firstUnavailableAt:
        typeof stamp === "number" && Number.isFinite(stamp) ? stamp : null,
    });
  }
  return records;
}

export function nextLinkedRecords(
  records: readonly LinkedTerminalRecord[],
  results: readonly PromiseSettledResult<{ id: string }>[],
  now: number,
): LinkedTerminalRecord[] {
  return records.flatMap((record, index) => {
    const result = results[index];
    if (!result) return [record];
    if (result.status === "fulfilled") {
      return [{ id: result.value.id, firstUnavailableAt: null }];
    }
    const stamp = record.firstUnavailableAt ?? now;
    if (now - stamp > DEAD_TERMINAL_GRACE_MS) return [];
    return [{ id: record.id, firstUnavailableAt: stamp }];
  });
}

export function nextLinkedTerminalIds(
  linkedIds: readonly string[],
  results: readonly PromiseSettledResult<{ id: string }>[],
  now = Date.now(),
): string[] {
  return nextLinkedRecords(
    linkedIds.map((id) => ({ id, firstUnavailableAt: null })),
    results,
    now,
  ).map((record) => record.id);
}

export function reconcileLinkedRecords(
  current: readonly LinkedTerminalRecord[],
  snapshot: readonly LinkedTerminalRecord[],
  results: readonly PromiseSettledResult<{ id: string }>[],
  now: number,
): LinkedTerminalRecord[] {
  const nextBySnapshotId = new Map<string, LinkedTerminalRecord | null>();
  snapshot.forEach((record, index) => {
    const next = nextLinkedRecords(
      [record],
      results[index] ? [results[index]] : [],
      now,
    );
    nextBySnapshotId.set(record.id, next[0] ?? null);
  });
  return current.flatMap((record) => {
    if (!nextBySnapshotId.has(record.id)) return [record];
    const next = nextBySnapshotId.get(record.id);
    return next ? [next] : [];
  });
}
