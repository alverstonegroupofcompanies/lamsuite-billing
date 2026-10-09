import { sqliteStorage } from "../db/sqliteStorage";
import type { PurchaseDocumentInput } from "./purchaseService";

export interface PurchaseDraftItem {
  id: string;
  title: string;
  supplier_id?: string;
  supplier_name?: string;
  supplier_invoice_no?: string;
  item_count: number;
  total_estimate: number;
  payload: PurchaseDocumentInput;
  updated_at: number;
}

export class PurchaseDraftService {
  async saveDraft(draft: {
    id?: string;
    title?: string;
    document: PurchaseDocumentInput;
  }): Promise<{ success: boolean; draftId: string }> {
    const draftId = draft.id || `draft_pur_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    const title =
      draft.title ||
      `${draft.document.supplier_name || "Untitled Supplier"} (${draft.document.lines.length} items) - ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    let estTotal = 0;
    for (const l of draft.document.lines) {
      const units = (l.pack_qty || l.qty || 0) * (l.units_per_pack || 1);
      const rate = l.purchase_rate || 0;
      estTotal += units * rate;
    }

    const draftRecord = {
      id: draftId,
      title,
      supplier_id: draft.document.supplier_id || "",
      supplier_name: draft.document.supplier_name || "",
      supplier_invoice_no: draft.document.supplier_invoice_no || "",
      item_count: draft.document.lines.length,
      total_estimate: Math.round(estTotal * 100) / 100,
      payload_json: JSON.stringify(draft.document),
      updated_at: now,
    };

    await sqliteStorage.insertRecord("purchase_drafts", draftId, draftRecord);
    return { success: true, draftId };
  }

  async getAllDrafts(): Promise<PurchaseDraftItem[]> {
    const records = await sqliteStorage.findAll<any>("purchase_drafts");
    return records
      .map((r) => {
        let parsedPayload: PurchaseDocumentInput = {
          purchase_number: "",
          supplier_id: "",
          supplier_name: "",
          supplier_invoice_no: "",
          purchase_date: new Date().toISOString().slice(0, 10),
          lines: [],
        };
        try {
          parsedPayload = typeof r.payload_json === "string" ? JSON.parse(r.payload_json) : r.payload_json;
        } catch {
          // ignore parse error
        }

        return {
          id: r.id,
          title: r.title || "Untitled Draft",
          supplier_id: r.supplier_id,
          supplier_name: r.supplier_name,
          supplier_invoice_no: r.supplier_invoice_no,
          item_count: r.item_count || parsedPayload.lines?.length || 0,
          total_estimate: r.total_estimate || 0,
          payload: parsedPayload,
          updated_at: r.updated_at || Date.now(),
        };
      })
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  async getDraftById(id: string): Promise<PurchaseDraftItem | null> {
    const r = await sqliteStorage.findById<any>("purchase_drafts", id);
    if (!r) return null;

    let parsedPayload: PurchaseDocumentInput = {
      purchase_number: "",
      supplier_id: "",
      supplier_name: "",
      supplier_invoice_no: "",
      purchase_date: new Date().toISOString().slice(0, 10),
      lines: [],
    };
    try {
      parsedPayload = typeof r.payload_json === "string" ? JSON.parse(r.payload_json) : r.payload_json;
    } catch {
      // ignore
    }

    return {
      id: r.id,
      title: r.title || "Untitled Draft",
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      supplier_invoice_no: r.supplier_invoice_no,
      item_count: r.item_count || parsedPayload.lines?.length || 0,
      total_estimate: r.total_estimate || 0,
      payload: parsedPayload,
      updated_at: r.updated_at || Date.now(),
    };
  }

  async deleteDraft(id: string): Promise<boolean> {
    return await sqliteStorage.deleteRecord("purchase_drafts", id);
  }
}

export const purchaseDraftService = new PurchaseDraftService();
