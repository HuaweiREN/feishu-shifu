import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch-timeout.js";

describe("fetchWithTimeout", () => {
  it("returns the response when fetch completes before timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));

    const response = await fetchWithTimeout("https://example.com", undefined, 5000, "test request");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("throws a descriptive error when fetch times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            }
          })
      )
    );

    const promise = fetchWithTimeout("https://example.com", undefined, 10_000, "Feishu test request");
    vi.advanceTimersByTime(10_000);
    await expect(promise).rejects.toThrow("Feishu test request timed out after 10 seconds.");
    vi.useRealTimers();
  });

  it("re-throws non-AbortError fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network error"); }));

    await expect(fetchWithTimeout("https://example.com", undefined, 5000, "test request")).rejects.toThrow(
      "Network error"
    );
  });
});
