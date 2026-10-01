import { describe, it, expect } from "vitest";
import { selectBatchesFefo, isDateExpired } from "../../src/utils/fefo.js";

describe("FEFO (First Expiry, First Out) Batch Selection", () => {
  const refDate = new Date("2026-10-01T00:00:00Z");

  const sampleBatches = [
    {
      id: "b3",
      batch_no: "BATCH-2028",
      expiry_date: "2028-12-31",
      stock_qty: 100,
    },
    {
      id: "b1",
      batch_no: "BATCH-2027-MAR",
      expiry_date: "2027-03-31", // Earliest valid batch
      stock_qty: 10,
    },
    {
      id: "b2",
      batch_no: "BATCH-2027-AUG",
      expiry_date: "2027-08-31",
      stock_qty: 25,
    },
    {
      id: "b0_expired",
      batch_no: "BATCH-2025-EXPIRED",
      expiry_date: "2025-01-01", // Already expired
      stock_qty: 50,
    },
  ];

  it("identifies expired dates correctly", () => {
    expect(isDateExpired("2025-01-01", refDate)).toBe(true);
    expect(isDateExpired("2027-01-01", refDate)).toBe(false);
  });

  it("selects earliest expiring batch first when requested qty fits in one batch", () => {
    const allocations = selectBatchesFefo(sampleBatches, 5, "Dolo 650", refDate);
    expect(allocations.length).toBe(1);
    expect(allocations[0].batch_no).toBe("BATCH-2027-MAR");
    expect(allocations[0].allocated_qty).toBe(5);
  });

  it("splits requested quantity across multiple batches in chronological order of expiry", () => {
    // Request 15 units: 10 from BATCH-2027-MAR and 5 from BATCH-2027-AUG
    const allocations = selectBatchesFefo(sampleBatches, 15, "Dolo 650", refDate);
    expect(allocations.length).toBe(2);
    expect(allocations[0].batch_no).toBe("BATCH-2027-MAR");
    expect(allocations[0].allocated_qty).toBe(10);
    expect(allocations[1].batch_no).toBe("BATCH-2027-AUG");
    expect(allocations[1].allocated_qty).toBe(5);
  });

  it("completely ignores expired batches even if they have stock", () => {
    const allocations = selectBatchesFefo(sampleBatches, 35, "Dolo 650", refDate);
    // BATCH-2027-MAR (10) + BATCH-2027-AUG (25) = 35
    for (const alloc of allocations) {
      expect(alloc.batch_no).not.toBe("BATCH-2025-EXPIRED");
    }
  });

  it("throws clear error when total valid stock across batches is insufficient", () => {
    // Total available unexpired stock = 10 + 25 + 100 = 135
    expect(() =>
      selectBatchesFefo(sampleBatches, 200, "Dolo 650", refDate)
    ).toThrow(/Insufficient available stock for 'Dolo 650'/);
  });
});
