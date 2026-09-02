const mountedWtermTabsByThread = new Map<string, number>();
const pendingWtermOpensByThread = new Map<string, number>();

function addCount(store: Map<string, number>, threadId: string, delta: number): void {
  const next = (store.get(threadId) ?? 0) + delta;
  if (next <= 0) store.delete(threadId);
  else store.set(threadId, next);
}

export function wtermOpenCount(threadId: string): number {
  return (
    (mountedWtermTabsByThread.get(threadId) ?? 0) +
    (pendingWtermOpensByThread.get(threadId) ?? 0)
  );
}

export function beginWtermOpen(threadId: string): () => void {
  addCount(pendingWtermOpensByThread, threadId, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    addCount(pendingWtermOpensByThread, threadId, -1);
  };
}

export function trackWtermMount(threadId: string): () => void {
  addCount(mountedWtermTabsByThread, threadId, 1);
  addCount(pendingWtermOpensByThread, threadId, -1);
  return () => {
    addCount(mountedWtermTabsByThread, threadId, -1);
  };
}

export function resetWtermOpenCounts(): void {
  mountedWtermTabsByThread.clear();
  pendingWtermOpensByThread.clear();
}
