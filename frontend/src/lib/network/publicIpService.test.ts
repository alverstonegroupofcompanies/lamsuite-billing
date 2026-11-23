import { describe, it, expect, afterEach, vi } from "vitest";
import { PublicIpService } from "./publicIpService";
import { API_BASE_URL } from "../../config/env";

describe("PublicIpService - configured server only (UPD-01)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks only the configured server, even when it reports a loopback address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // A browser/desktop window that is online: the case where a third-party
    // IP echo used to be tried.
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ip: "127.0.0.1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const ip = await new PublicIpService().getPublicIp(true);

    expect(ip).toBeNull();
    const configuredHost = new URL(API_BASE_URL).host;
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>;
    expect(calls.length).toBeGreaterThan(0);
    for (const [url] of calls) {
      expect(new URL(String(url)).host).toBe(configuredHost);
    }
  });

  it("returns the address the configured server sees", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ip: "203.0.113.7" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    expect(await new PublicIpService().getPublicIp(true)).toBe("203.0.113.7");
  });
});
