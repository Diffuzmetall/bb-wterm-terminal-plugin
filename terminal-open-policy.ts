export interface TerminalOpenCandidate {
  id: string;
  status: string;
}

export function isActiveStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "starting";
}

export function evaluateTerminalPresence({
  attempt,
  gracePeriodAttempts = 2,
  maxAttempts = 6,
  sessions,
  terminalId,
}: {
  attempt: number;
  gracePeriodAttempts?: number;
  maxAttempts?: number;
  sessions: readonly TerminalOpenCandidate[] | null;
  terminalId: string;
}): "ready" | "retry" | "missing" {
  if (sessions === null) return attempt < maxAttempts ? "retry" : "ready";
  const selected = sessions.find((session) => session.id === terminalId);
  if (selected && isActiveStatus(selected.status)) return "ready";
  if (selected) return "missing";
  if (attempt <= gracePeriodAttempts || attempt < maxAttempts) return "retry";
  return "missing";
}

export function terminalIdAfterListFailure({
  lastTerminalId,
  openTabCount,
}: {
  lastTerminalId: string | null;
  openTabCount: number;
}): string | null {
  if (openTabCount > 0) return null;
  return lastTerminalId;
}

export function reusableTerminalId({
  lastTerminalId,
  openTabCount,
  sessions,
}: {
  lastTerminalId: string | null;
  openTabCount: number;
  sessions: readonly TerminalOpenCandidate[];
}): string | null {
  if (openTabCount > 0 || lastTerminalId === null) return null;
  const previous = sessions.find((session) => session.id === lastTerminalId);
  return previous && isActiveStatus(previous.status) ? previous.id : null;
}
