import { describe, it, expect, vi, beforeEach } from "vitest";
import { whatsappService } from "./whatsappService";
import { companySettingsService } from "../settings/companySettingsService";
import type { InvoicePrintData } from "../printing/printingEngine";

describe("WhatsAppService (OpenWA Integration)", () => {
  const sampleInvoice: InvoicePrintData = {
    invoice_number: "INV-999888",
    invoice_date: "2026-11-03",
    store_name: "Alverstone Care",
    phone: "9876543210",
    subtotal: 500,
    tax_total: 60,
    round_off: 0,
    grand_total: 560,
    lines: [
      {
        description: "Amoxicillin 500mg",
        qty: 2,
        rate: 250,
        amount: 500,
        gst_percent: 12,
      },
    ],
    items: [
      {
        item_id: "itm_1",
        name: "Amoxicillin 500mg",
        quantity: 2,
        unit_price: 250,
        tax_amount: 60,
        total_amount: 560,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatChatId", () => {
    it("formats 10-digit Indian phone numbers with 91 and @c.us suffix", () => {
      expect(whatsappService.formatChatId("9876543210")).toBe("919876543210@c.us");
    });

    it("strips country code prefix (+91), spaces, and dashes", () => {
      expect(whatsappService.formatChatId("+91 98765-43210")).toBe("919876543210@c.us");
    });

    it("replaces leading zero with 91 for standard domestic format", () => {
      expect(whatsappService.formatChatId("09876543210")).toBe("919876543210@c.us");
    });
  });

  describe("uint8ArrayToBase64", () => {
    it("converts byte arrays into valid base64 strings", () => {
      const bytes = new TextEncoder().encode("Hello OpenWA");
      const base64 = whatsappService.uint8ArrayToBase64(bytes);
      expect(base64).toBe(btoa("Hello OpenWA"));
    });
  });

  describe("buildCaption", () => {
    it("creates formatted message caption with invoice number, date, and grand total", () => {
      const caption = whatsappService.buildCaption(sampleInvoice);
      expect(caption).toContain("*Tax Invoice #INV-999888*");
      expect(caption).toContain("*Alverstone Care*");
      expect(caption).toContain("₹560.00");
      expect(caption).toContain("2026-11-03");
    });

    it("interpolates custom template variables", () => {
      const customTemplate = "Bill {invoice_no} at {store_name} = {grand_total}";
      const caption = whatsappService.buildCaption(sampleInvoice, customTemplate);
      expect(caption).toBe("Bill INV-999888 at Alverstone Care = ₹560.00");
    });
  });

  describe("dispatchInvoice", () => {
    it("rejects invalid or too short phone numbers", async () => {
      const result = await whatsappService.dispatchInvoice("123", sampleInvoice);
      expect(result.success).toBe(false);
      expect(result.error).toContain("valid customer mobile");
    });

    it("provides manual share fallbackUrl if WhatsApp is disabled in settings", async () => {
      vi.spyOn(companySettingsService, "loadSettings").mockResolvedValue({
        store_id: "store_main",
        whatsapp: {
          enabled: false,
          provider: "manual_link",
          apiUrl: "https://wa-api.alverstone.in",
          apiKey: "",
          sessionId: "default",
          sendPdfInvoice: true,
          autoSendOnBillSave: false,
        },
      } as any);

      const result = await whatsappService.dispatchInvoice("9876543210", sampleInvoice);
      expect(result.success).toBe(false);
      expect(result.fallbackUrl).toContain("https://wa.me/919876543210");
    });

    it("dispatches invoice to relay endpoint when enabled and returns success", async () => {
      vi.spyOn(companySettingsService, "loadSettings").mockResolvedValue({
        store_id: "store_main",
        whatsapp: {
          enabled: true,
          provider: "openwa",
          apiUrl: "https://wa-api.alverstone.in",
          apiKey: "valid_api_key_test",
          sessionId: "default",
          sendPdfInvoice: true,
          autoSendOnBillSave: false,
        },
      } as any);

      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: { id: "msg_wa_001" },
        }),
      });
      global.fetch = fakeFetch as any;

      const result = await whatsappService.dispatchInvoice("9876543210", sampleInvoice);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg_wa_001");

      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const callArgs = fakeFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.phone).toBe("9876543210");
      expect(payload.api_url).toBe("https://wa-api.alverstone.in");
      expect(payload.api_key).toBe("valid_api_key_test");
      expect(payload.session_id).toBe("default");
    });

    it("handles relay error and falls back with fallbackUrl", async () => {
      vi.spyOn(companySettingsService, "loadSettings").mockResolvedValue({
        store_id: "store_main",
        whatsapp: {
          enabled: true,
          provider: "openwa",
          apiUrl: "https://wa-api.alverstone.in",
          apiKey: "bad_key",
          sessionId: "default",
          sendPdfInvoice: false,
          autoSendOnBillSave: false,
        },
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: "Unauthorized: Invalid API key",
        }),
      }) as any;

      const result = await whatsappService.dispatchInvoice("9876543210", sampleInvoice);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid API key");
      expect(result.fallbackUrl).toContain("https://wa.me/919876543210");
    });
  });

  describe("fetchSessions & testConnection", () => {
    it("parses sessions array from endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          sessions: [
            { id: "counter-1", name: "Counter 1", status: "ready" },
          ],
        }),
      }) as any;

      const res = await whatsappService.fetchSessions("https://wa-api.alverstone.in", "test_key");
      expect(res.success).toBe(true);
      expect(res.sessions.length).toBe(1);
      expect(res.sessions[0].id).toBe("counter-1");
    });

    it("tests connection against validate endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          valid: true,
          role: "operator",
          engineType: "GOWS",
        }),
      }) as any;

      const res = await whatsappService.testConnection("https://wa-api.alverstone.in", "test_key");
      expect(res.success).toBe(true);
      expect(res.valid).toBe(true);
      expect(res.role).toBe("operator");
    });
  });
});
