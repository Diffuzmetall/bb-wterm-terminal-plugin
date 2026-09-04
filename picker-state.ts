import { isActiveStatus } from "./terminal-open-policy.js";

export type PickerSession = {
  id: string;
  title: string;
  initialCwd: string | null;
  status: string;
  updatedAt: number;
  lastUserInputAt: number | null;
};

export type PickerListState =
  | { kind: "loading" }
  | { kind: "loaded"; items: PickerSession[] }
  | { kind: "failed"; message: string };

export function parsePickerSessions(value: unknown): PickerSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { id?: unknown }).id !== "string" ||
      (item as { id: string }).id.length === 0 ||
      typeof (item as { title?: unknown }).title !== "string" ||
      typeof (item as { status?: unknown }).status !== "string" ||
      typeof (item as { updatedAt?: unknown }).updatedAt !== "number"
    ) {
      return [];
    }
    const initialCwd = (item as { initialCwd?: unknown }).initialCwd;
    const lastUserInputAt = (item as { lastUserInputAt?: unknown })
      .lastUserInputAt;
    return [
      {
        id: (item as { id: string }).id,
        title: (item as { title: string }).title,
        initialCwd: typeof initialCwd === "string" ? initialCwd : null,
        status: (item as { status: string }).status,
        updatedAt: (item as { updatedAt: number }).updatedAt,
        lastUserInputAt:
          typeof lastUserInputAt === "number" ? lastUserInputAt : null,
      },
    ];
  });
}

export function pickerStateFromRpc(
  result: PromiseSettledResult<unknown>,
): PickerListState {
  if (result.status === "rejected") {
    return {
      kind: "failed",
      message:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? "Could not list sessions"),
    };
  }
  if (!Array.isArray(result.value)) {
    return { kind: "failed", message: "Could not list sessions" };
  }
  return { kind: "loaded", items: parsePickerSessions(result.value) };
}

export function partitionRunningExited<T extends { status: string }>(
  items: readonly T[],
): { running: T[]; exited: T[] } {
  const running: T[] = [];
  const exited: T[] = [];
  for (const item of items) {
    if (isActiveStatus(item.status)) running.push(item);
    else exited.push(item);
  }
  return { running, exited };
}
