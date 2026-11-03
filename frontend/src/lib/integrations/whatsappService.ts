/**
 * WhatsApp Gateway Service (OpenWA REST API Integration)
 * Handles automated invoice dispatch (PDF document + text summary)
 * via self-hosted OpenWA gateway, with seamless fallback to manual wa.me links.
 */

import { getResolvedApiBaseUrl } from "../../config/env";
import { companySettingsService } from "../settings/companySettingsService";
import { printingEngine, InvoicePrintData, generateWhatsAppShareUrl } from "../printing/printingEngine";
import { isTauri } from "../ipc/ipcBridge";

export interface WhatsAppSessionInfo {
  id: string;
  name: string;
  status: string;
}

export interface WhatsAppDispatchResult {
  success: boolean;
  messageId?: string;
  fallbackUrl?: string;
  error?: string;
}

export class WhatsAppService {
  /**
   * Format any raw phone number into standard WhatsApp JID: <phone>@c.us
   * Auto-prepends country code 91 for 10-digit Indian numbers.
   */
  formatChatId(phone: string): string {
    const clean = phone.replace(/\D/g, "");
    if (clean.length === 10) {
      return `91${clean}@c.us`;
    }
    if (clean.length === 11 && clean.startsWith("0")) {
      return `91${clean.slice(1)}@c.us`;
    }
    return `${clean}@c.us`;
  }

  /**
   * Converts a Uint8Array into a standard Base64 string safely across chunk boundaries.
   */
  uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  /**
   * Build formatted WhatsApp bill summary caption.
   */
  buildCaption(data: InvoicePrintData, customTemplate?: string): string {
    const totalFormatted = `₹${data.grand_total.toFixed(2)}`;
    const lineCount = data.lines?.length || (data as any).items?.length || 0;

    if (customTemplate && customTemplate.trim()) {
      return customTemplate
        .replace(/\{invoice_no\}/g, data.invoice_number)
        .replace(/\{store_name\}/g, data.store_name)
        .replace(/\{grand_total\}/g, totalFormatted)
        .replace(/\{date\}/g, data.invoice_date)
        .replace(/\{items_count\}/g, String(lineCount));
    }

    const lines = [
      `*Tax Invoice #${data.invoice_number}* from *${data.store_name}*`,
      `📅 Date: ${data.invoice_date}`,
      `📦 Items: ${lineCount} | Total Amount: *${totalFormatted}*`,
    ];

    if (data.payment_mode) {
      lines.push(`💳 Payment: ${data.payment_mode.toUpperCase()}`);
    }

    const storePhone = data.store_phone || (data as any).phone;
    if (storePhone) {
      lines.push(`📞 Store Contact: ${storePhone}`);
    }

    lines.push(`\nThank you for shopping with us! Get well soon.`);
    return lines.join("\n");
  }

  /**
   * Dispatches an invoice directly via OpenWA.
   * If OpenWA is disabled, unconfigured, or errors out, returns a fallbackUrl.
   */
  async dispatchInvoice(
    phone: string,
    data: InvoicePrintData,
    options?: { sendPdf?: boolean }
  ): Promise<WhatsAppDispatchResult> {
    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      return {
        success: false,
        error: "Please provide a valid customer mobile number.",
      };
    }

    const fallbackUrl = generateWhatsAppShareUrl(phone, data);

    try {
      const settings = await companySettingsService.loadSettings();
      const waConfig = settings.whatsapp;

      // If integration is disabled or provider is manual link only:
      if (!waConfig || !waConfig.enabled || waConfig.provider === "manual_link") {
        return {
          success: false,
          fallbackUrl,
          error: "WhatsApp gateway is not enabled. Use manual WhatsApp link.",
        };
      }

      const caption = this.buildCaption(data, waConfig.customCaption);
      const shouldSendPdf = options?.sendPdf ?? (waConfig.sendPdfInvoice ?? true);

      let pdfBase64: string | undefined;
      const cleanInv = data.invoice_number.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Invoice_${cleanInv}.pdf`;

      if (shouldSendPdf) {
        try {
          const pdfBytes = printingEngine.generateInvoicePdf(data);
          pdfBase64 = this.uint8ArrayToBase64(pdfBytes);
        } catch (pdfErr) {
          console.warn("Could not generate vector PDF attachment, falling back to text caption:", pdfErr);
        }
      }

      const baseUrl = getResolvedApiBaseUrl();
      const relayEndpoint = `${baseUrl}/api/whatsapp/send-invoice`;

      // Dispatch through backend relay
      const response = await fetch(relayEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          phone: cleanPhone,
          caption,
          pdf_base64: pdfBase64,
          filename,
          api_url: waConfig.apiUrl,
          api_key: waConfig.apiKey || undefined,
          session_id: waConfig.sessionId || "default",
          store_id: settings.store_id || undefined,
        }),
      });

      const resJson = await response.json().catch(() => ({}));

      if (response.ok && resJson.success) {
        return {
          success: true,
          messageId: resJson.result?.id || resJson.result?.messageId,
        };
      }

      // If backend relay returned error
      const errorMsg = resJson.error || `OpenWA gateway error (${response.status})`;
      return {
        success: false,
        fallbackUrl,
        error: errorMsg,
      };

    } catch (err: any) {
      console.error("WhatsApp dispatch error:", err);
      return {
        success: false,
        fallbackUrl,
        error: err?.message || "Failed to contact WhatsApp relay server.",
      };
    }
  }

  /**
   * Query available OpenWA sessions from the relay/gateway.
   */
  async fetchSessions(apiUrl?: string, apiKey?: string): Promise<{ success: boolean; sessions: WhatsAppSessionInfo[]; error?: string }> {
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const params = new URLSearchParams();
      if (apiUrl) params.set("api_url", apiUrl);
      if (apiKey) params.set("api_key", apiKey);

      const endpoint = `${baseUrl}/api/whatsapp/sessions${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        return { success: true, sessions: data.sessions || [] };
      }
      return { success: false, sessions: [], error: data.error || "Failed to fetch sessions" };
    } catch (err: any) {
      return { success: false, sessions: [], error: err?.message || "Cannot connect to server" };
    }
  }

  /**
   * Validate credentials against OpenWA gateway.
   */
  async testConnection(apiUrl?: string, apiKey?: string): Promise<{ success: boolean; valid?: boolean; role?: string; engineType?: string; error?: string }> {
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const endpoint = `${baseUrl}/api/whatsapp/test-connection`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          api_url: apiUrl,
          api_key: apiKey,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        return {
          success: true,
          valid: data.valid,
          role: data.role,
          engineType: data.engineType,
        };
      }
      return {
        success: false,
        valid: false,
        error: data.error || "Authentication failed with OpenWA",
      };
    } catch (err: any) {
      return {
        success: false,
        valid: false,
        error: err?.message || "Could not reach OpenWA test endpoint",
      };
    }
  }

  /**
   * Open manual WhatsApp link fallback in browser or Tauri shell.
   */
  openManualShare(phone: string, data: InvoicePrintData): void {
    const url = generateWhatsAppShareUrl(phone, data);
    if (isTauri()) {
      import("@tauri-apps/api/shell")
        .then(({ open }) => open(url))
        .catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  }
}

export const whatsappService = new WhatsAppService();
