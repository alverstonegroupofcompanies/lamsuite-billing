import { afterEach, describe, expect, it, vi } from "vitest";
import { clientMigrationEngine } from "./clientMigrationEngine";

/**
 * Every failure of the legacy pull used to come back as one sentence — "Could not
 * connect to <host>: <message>. If the server is offline or CORS blocked" — including
 * failures where the server had answered perfectly well. A 401 told the operator to
 * check the network, so an expired token read as a dead server. Each signature now has
 * to name its own cause.
 */
async function errorFrom(fetchImpl: () => Promise<Response>): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  try {
    await clientMigrationEngine.fetchSourceData("api", { url: "https://admin.example.com", token: "t0k" });
  } catch (err: any) {
    return err.message;
  }
  throw new Error("expected the pull to fail, but it returned");
}

function respondWith(status: number, body = "") {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: async () => JSON.parse(body),
    }) as unknown as Response;
}

describe("the legacy pull names the actual failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the host may be the portal when nothing answered", async () => {
    const message = await errorFrom(async () => {
      throw new TypeError("Load failed");
    });

    expect(message).toContain("Could not reach https://admin.example.com");
    expect(message).toContain("legacy v1 panel host, not the portal host");
    expect(message).not.toContain("rejected the token");
  });

  it("blames the token on 401, not the network", async () => {
    const message = await errorFrom(respondWith(401));

    expect(message).toContain("rejected the token (HTTP 401)");
    expect(message).toContain("/admin/migration-token");
    expect(message).not.toContain("Could not reach");
  });

  it("blames the token on 403", async () => {
    const message = await errorFrom(respondWith(403));
    expect(message).toContain("rejected the token (HTTP 403)");
  });

  it("says the host is not the legacy panel on 404", async () => {
    const message = await errorFrom(respondWith(404));

    expect(message).toContain("has no /api/sync/pull");
    expect(message).toContain("not the legacy v1 panel");
  });

  it("says a non-JSON body came from the portal", async () => {
    const message = await errorFrom(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }) as unknown as Response
    );

    expect(message).toContain("not JSON");
  });

  it("passes any other status through", async () => {
    const message = await errorFrom(respondWith(500));
    expect(message).toContain("HTTP 500");
  });
});

describe("the legacy pull still succeeds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the snapshot and normalises a trailing slash", async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: { snapshot: { products: [{ id: 1 }] } } }),
      }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await clientMigrationEngine.fetchSourceData("api", {
      url: "https://admin.example.com/",
      token: "t0k",
    });

    expect(snapshot).toEqual({ products: [{ id: 1 }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://admin.example.com/api/sync/pull?limit=0");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer t0k", Accept: "application/json" },
    });
  });
});
