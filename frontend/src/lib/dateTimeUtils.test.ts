import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  formatInStoreTZ,
  getPeriodRange,
  getStoreTimezone,
  isDateInRange,
  parseStoreDate,
  toStoreDateString,
} from "./dateTimeUtils";

const IST = "Asia/Kolkata";

describe("store timezone helpers", () => {
  it("interprets date-only values as store-local, not UTC", () => {
    expect(parseStoreDate("2026-10-30", IST).toISOString()).toBe("2026-10-29T18:30:00.000Z");
  });

  it("round-trips a UTC instant to the store calendar date", () => {
    expect(formatInStoreTZ(new Date("2026-10-29T18:30:00Z"), IST)).toBe("2026-10-30");
    expect(formatInStoreTZ(new Date("2026-10-29T18:15:00Z"), IST)).toBe("2026-10-29");
  });

  it("dates a 23:30 IST and 00:30 IST bill on the correct days", () => {
    const lateNight = new Date("2026-10-29T18:00:00Z"); // 23:30 IST Oct 29
    const afterMidnight = new Date("2026-10-29T19:00:00Z"); // 00:30 IST Oct 30
    expect(formatInStoreTZ(lateNight, IST)).toBe("2026-10-29");
    expect(formatInStoreTZ(afterMidnight, IST)).toBe("2026-10-30");
  });

  it("is independent of the device timezone", () => {
    // The function takes the store tz explicitly; a foreign device clock does
    // not change the result.
    const instant = new Date("2026-10-29T19:00:00Z");
    expect(formatInStoreTZ(instant, IST)).toBe("2026-10-30");
    expect(formatInStoreTZ(instant, "UTC")).toBe("2026-10-29");
  });

  it("converts timestamp-shaped values to the store date", () => {
    expect(toStoreDateString("2026-10-29T18:30:00Z", IST)).toBe("2026-10-30");
    expect(toStoreDateString("2026-10-29", IST)).toBe("2026-10-29");
  });

  it("builds half-open today ranges in the store timezone", () => {
    const now = new Date("2026-10-29T18:45:00Z"); // 00:15 IST Oct 30
    const range = getPeriodRange("today", IST, now);
    expect(range.startDate).toBe("2026-10-30");
    expect(range.endDate).toBe("2026-10-30");
    expect(range.startUtc?.toISOString()).toBe("2026-10-29T18:30:00.000Z");
    expect(range.endUtc?.toISOString()).toBe("2026-10-30T18:30:00.000Z");
  });

  it("builds yesterday, last 7 days, week and month ranges", () => {
    const now = new Date("2026-10-29T12:00:00Z"); // 17:30 IST Oct 29
    expect(getPeriodRange("yesterday", IST, now).startDate).toBe("2026-10-28");
    expect(getPeriodRange("yesterday", IST, now).endDate).toBe("2026-10-28");
    expect(getPeriodRange("last7", IST, now).startDate).toBe("2026-10-23");
    expect(getPeriodRange("this_month", IST, now).startDate).toBe("2026-10-01");
    // 2026-10-29 is a Thursday; week starts Monday 2026-10-26.
    expect(getPeriodRange("this_week", IST, now).startDate).toBe("2026-10-26");
    expect(getPeriodRange("all_time", IST, now)).toEqual({
      startDate: null,
      endDate: null,
      startUtc: null,
      endUtc: null,
    });
  });

  it("handles DST transitions when parsing local midnight", () => {
    // US DST starts 2026-03-08.
    expect(parseStoreDate("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(parseStoreDate("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("compares date-only values inclusively", () => {
    expect(isDateInRange("2026-10-29", "2026-10-29", "2026-10-29", IST)).toBe(true);
    expect(isDateInRange("2026-10-29T18:30:00Z", "2026-10-30", "2026-10-30", IST)).toBe(true);
    expect(isDateInRange("2026-10-28", "2026-10-29", "2026-10-29", IST)).toBe(false);
  });

  it("adds calendar days without timezone drift", () => {
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("reads the store timezone from settings or store records", () => {
    expect(getStoreTimezone({ timezone: "Asia/Dubai" })).toBe("Asia/Dubai");
    expect(getStoreTimezone({ store_details: { timezone: "Asia/Singapore" } })).toBe("Asia/Singapore");
    expect(getStoreTimezone({})).toBe("Asia/Kolkata");
  });
});
