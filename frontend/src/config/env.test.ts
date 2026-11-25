import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * The wizard's "Direct Laravel API" source needs the legacy v1 panel host. It used to
 * default to the portal host, which answers /api/sync/pull with index.html and no CORS
 * headers — so the request died as a bare network error and a valid token looked broken.
 */
async function loadEnv() {
  vi.resetModules();
  return import("./env");
}

describe("the legacy API host is its own setting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the v1 admin panel", async () => {
    const { LEGACY_API_URL } = await loadEnv();
    expect(LEGACY_API_URL).toBe("https://admin.lamstonehealthcare.com");
  });

  it("takes the configured host and drops trailing slashes", async () => {
    vi.stubEnv("VITE_LEGACY_API_URL", "https://legacy.internal:8443///");
    const { LEGACY_API_URL } = await loadEnv();
    expect(LEGACY_API_URL).toBe("https://legacy.internal:8443");
  });

  it("is never the portal host", async () => {
    vi.stubEnv("VITE_ADMIN_PORTAL_URL", "https://app.lamstonehealthcare.com");
    const { LEGACY_API_URL, PANEL_PORTAL_URL } = await loadEnv();

    expect(PANEL_PORTAL_URL).toBe("https://app.lamstonehealthcare.com");
    expect(LEGACY_API_URL).not.toBe(PANEL_PORTAL_URL);
    expect(new URL(LEGACY_API_URL).hostname.startsWith("app.")).toBe(false);
  });
});
