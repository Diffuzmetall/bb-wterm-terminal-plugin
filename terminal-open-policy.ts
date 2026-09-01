export interface TerminalOpenCandidate {
  id: string;
  status: string;
}

function isActiveStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "starting";
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
