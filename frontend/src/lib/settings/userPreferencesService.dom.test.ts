import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesService } from "./userPreferencesService";

const jsonResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as Response;

describe("UserPreferencesService", () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new UserPreferencesService();
  });

  it("caches a preference immediately and pushes it to the server", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ preferences: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await service.set("usr_1", "bills.period", "this_month");

    expect(service.get("usr_1")["bills.period"]).toBe("this_month");
    expect(JSON.parse(window.localStorage.getItem("lamsuite_user_prefs_usr_1")!)).toEqual({
      "bills.period": "this_month",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/me/preferences");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ preferences: { "bills.period": "this_month" } });
  });

  it("survives the server being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));

    await expect(service.set("usr_1", "bills.period", "yesterday")).resolves.toEqual({
      "bills.period": "yesterday",
    });
    expect(service.get("usr_1")["bills.period"]).toBe("yesterday");
  });

  it("merges remote preferences over the local cache on load", async () => {
    window.localStorage.setItem("lamsuite_user_prefs_usr_1", JSON.stringify({ localOnly: true }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ preferences: { "bills.period": "last7" } }))
    );

    const loaded = await service.load("usr_1");

    expect(loaded).toEqual({ localOnly: true, "bills.period": "last7" });
    expect(service.get("usr_1")).toEqual(loaded);
  });

  it("falls back to local preferences when loading fails", async () => {
    window.localStorage.setItem("lamsuite_user_prefs_usr_1", JSON.stringify({ "pos.columns": ["name"] }));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));

    expect(await service.load("usr_1")).toEqual({ "pos.columns": ["name"] });
  });

  it("keeps preferences isolated per user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ preferences: {} })));

    await service.set("usr_1", "bills.period", "this_month");
    await service.set("usr_2", "bills.period", "today");

    expect(service.get("usr_1")["bills.period"]).toBe("this_month");
    expect(service.get("usr_2")["bills.period"]).toBe("today");
  });
});
