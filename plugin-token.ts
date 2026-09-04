import { z } from "zod";
import { createRetryablePromiseCache } from "./retryable-cache.js";

export const PLUGIN_ID = "wterm-terminal-preview";

export const getPluginToken = createRetryablePromiseCache(async () => {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await response.json().catch(() => null);
  const parsed = z.object({ token: z.string() }).safeParse(json);
  if (!response.ok || !parsed.success) {
    throw new Error(`asset token request failed (HTTP ${response.status})`);
  }
  return parsed.data.token;
});
