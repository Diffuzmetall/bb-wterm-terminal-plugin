import { describe, expect, it, vi } from "vitest";
import { createRetryablePromiseCache } from "./retryable-cache";

describe("createRetryablePromiseCache", () => {
  it("shares one in-flight and fulfilled request", async () => {
    const load = vi.fn(async () => "ready");
    const cached = createRetryablePromiseCache(load);

    const [first, second] = await Promise.all([cached(), cached()]);

    expect(first).toBe("ready");
    expect(second).toBe("ready");
    expect(load).toHaveBeenCalledOnce();
    await expect(cached()).resolves.toBe("ready");
    expect(load).toHaveBeenCalledOnce();
  });

  it("retries after a failed request", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("ready");
    const cached = createRetryablePromiseCache(load);

    await expect(cached()).rejects.toThrow("offline");
    await expect(cached()).resolves.toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
