import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesService } from "./userPreferencesService";

describe("UserPreferencesService", () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new UserPreferencesService();
    vi.unstubAllGlobals();
  });

  it("remembers a preference under the caller that set it", async () => {
    await service.set("cntr_7", "bills.period", "this_month");

    expect(service.get("cntr_7")["bills.period"]).toBe("this_month");
    expect(JSON.parse(window.localStorage.getItem("lamsuite_user_prefs_cntr_7")!)).toEqual({
      "bills.period": "this_month",
    });
  });

  it("keeps preferences isolated per caller", async () => {
    await service.set("cntr_7", "bills.period", "this_month");
    await service.set("cntr_8", "bills.period", "today");

    expect(service.get("cntr_7")["bills.period"]).toBe("this_month");
    expect(service.get("cntr_8")["bills.period"]).toBe("today");
  });

  it("asks the network for nothing — the person-only route is not the till's to call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await service.set("cntr_7", "bills.period", "this_month");
    expect(await service.load("cntr_7")).toEqual({ "bills.period": "this_month" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves what it remembers with no network at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));

    await expect(service.set("cntr_7", "bills.period", "yesterday")).resolves.toEqual({
      "bills.period": "yesterday",
    });
    expect(service.get("cntr_7")["bills.period"]).toBe("yesterday");
  });

  it("reads back what an earlier call wrote, after the cache is dropped", async () => {
    await service.set("cntr_9", "pos.columns", ["name", "qty"]);
    service.clearCache();

    expect(service.get("cntr_9")).toEqual({ "pos.columns": ["name", "qty"] });
  });
});
