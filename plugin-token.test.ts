import { afterEach, describe, expect, it, vi } from "vitest";

describe("getPluginToken", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "shared" }),
    }));
    vi.stubGlobal("fetch", fetch);
    const { getPluginToken } = await import("./plugin-token.ts");

    const [first, second] = await Promise.all([
      getPluginToken(),
      getPluginToken(),
    ]);
    expect(first).toBe("shared");
    expect(second).toBe("shared");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries after a failed request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "ok" }),
      });
    vi.stubGlobal("fetch", fetch);
    const { getPluginToken } = await import("./plugin-token.ts");

    await expect(getPluginToken()).rejects.toThrow(
      "asset token request failed (HTTP 503)",
    );
    await expect(getPluginToken()).resolves.toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
