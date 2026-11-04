import { describe, it, expect, beforeEach, vi } from "vitest";
import { isIpv4, formatIpv4, deviceIpService } from "./deviceIpService";

describe("deviceIpService - Device IPv4 Detection & Normalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isIpv4", () => {
    it("validates standard IPv4 addresses", () => {
      expect(isIpv4("192.168.1.1")).toBe(true);
      expect(isIpv4("127.0.0.1")).toBe(true);
      expect(isIpv4("10.0.0.254")).toBe(true);
      expect(isIpv4("172.16.0.1")).toBe(true);
      expect(isIpv4("0.0.0.0")).toBe(true);
    });

    it("rejects invalid IPv4, IPv6, and non-numeric strings", () => {
      expect(isIpv4("")).toBe(false);
      expect(isIpv4(null)).toBe(false);
      expect(isIpv4(undefined)).toBe(false);
      expect(isIpv4("::1")).toBe(false);
      expect(isIpv4("256.0.0.1")).toBe(false);
      expect(isIpv4("192.168.1")).toBe(false);
      expect(isIpv4("192.168.1.1.1")).toBe(false);
      expect(isIpv4("192.168.1.abc")).toBe(false);
      expect(isIpv4("192.168.01.1")).toBe(false); // leading zeros rejected
    });
  });

  describe("formatIpv4", () => {
    it("normalizes IPv6 loopback to 127.0.0.1", () => {
      expect(formatIpv4("::1")).toBe("127.0.0.1");
      expect(formatIpv4("0:0:0:0:0:0:0:1")).toBe("127.0.0.1");
    });

    it("unwraps IPv4-mapped IPv6 addresses", () => {
      expect(formatIpv4("::ffff:192.168.0.15")).toBe("192.168.0.15");
      expect(formatIpv4("::FFFF:10.0.0.1")).toBe("10.0.0.1");
      expect(formatIpv4("::ffff:127.0.0.1")).toBe("127.0.0.1");
    });

    it("strips port from IPv4 string", () => {
      expect(formatIpv4("192.168.1.100:8000")).toBe("192.168.1.100");
    });

    it("falls back to default fallback for null or empty", () => {
      expect(formatIpv4(null)).toBe("127.0.0.1");
      expect(formatIpv4("")).toBe("127.0.0.1");
      expect(formatIpv4(null, "192.168.1.1")).toBe("192.168.1.1");
    });
  });

  describe("getLocalIpv4", () => {
    it("returns loopback or local IPv4 cleanly in test environment", async () => {
      const ip = await deviceIpService.getLocalIpv4();
      expect(isIpv4(ip)).toBe(true);
      expect(deviceIpService.getCachedLocalIpv4()).toBe(ip);
    });
  });
});
