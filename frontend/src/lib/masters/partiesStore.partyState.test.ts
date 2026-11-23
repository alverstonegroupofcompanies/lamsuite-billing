import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));

vi.mock("../sync/syncQueueService", () => ({
  syncQueueService: { enqueue: mocks.enqueue },
}));

vi.mock("../../config/env", () => ({
  getResolvedApiBaseUrl: () => "http://api.test",
}));

vi.mock("../settings/companySettingsService", () => ({
  companySettingsService: {
    getSettings: () => ({ state_code: "33" }),
  },
}));

import { partiesStore } from "./partiesStore";

function lastPostedBody(): Record<string, unknown> {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body ?? "{}"));
}

describe("partiesStore.quickCreateCustomer — party state (MST-01)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    mocks.enqueue.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ customer: { id: "server_1" } }),
    }) as unknown as typeof fetch;
  });

  it("takes the state from the GSTIN prefix and posts it", async () => {
    const created = await partiesStore.quickCreateCustomer({
      name: "Karnataka Trader",
      gstin: "29ABCDE1234F1Z5",
    });

    expect(created.state_code).toBe("29");
    expect(created.place_of_supply).toBe("29-Karnataka");
    expect(lastPostedBody().state_code).toBe("29");
  });

  it("falls back to the store's own state when there is no GSTIN", async () => {
    const created = await partiesStore.quickCreateCustomer({
      name: "Local Buyer",
      phone: "9876543210",
    });

    expect(created.state_code).toBe("33");
    expect(created.place_of_supply).toBe("33-Tamil Nadu");
    expect(lastPostedBody().state_code).toBe("33");
  });

  it("honours an explicit state choice that has no GSTIN", async () => {
    const created = await partiesStore.quickCreateCustomer({
      name: "Maharashtra Buyer",
      state_code: "27",
    });

    expect(created.state_code).toBe("27");
    expect(created.place_of_supply).toBe("27-Maharashtra");
    expect(lastPostedBody().state_code).toBe("27");
  });

  it("never stores a garbage state value", async () => {
    const created = await partiesStore.quickCreateCustomer({
      name: "Bad State Buyer",
      state_code: "3232",
    });

    expect(created.state_code).toBe("33");
  });
});
