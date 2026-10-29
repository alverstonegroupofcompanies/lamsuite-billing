import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";

export interface DistributedHeldBill {
  id: string;
  held_by_counter_id: string;
  held_by_counter_name: string;
  held_by_user_name: string;
  customer_name: string;
  items_count: number;
  grand_total: number;
  held_at: number;
  cart_payload: Record<string, unknown>;
  status: "held" | "claimed" | "cancelled";
  claimed_by_counter_id?: string;
  claimed_at?: number;
}

export class DistributedHeldBillService {
  private getEffectiveBaseUrl(): string {
    return getResolvedApiBaseUrl();
  }

  async holdBill(
    counterId: string,
    counterName: string,
    userName: string,
    cartPayload: Record<string, unknown>,
    itemsCount: number,
    grandTotal: number,
    customerName = "Walk-in Customer"
  ): Promise<string> {
    const holdId = `hold_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const record = {
      id: holdId,
      held_by_counter_id: counterId,
      held_by_counter_name: counterName,
      held_by_user_name: userName,
      customer_name: customerName,
      items_count: itemsCount,
      grand_total: grandTotal,
      held_at: Date.now(),
      cart_payload: cartPayload,
      status: "held",
    };

    // 1. Commit to local SQLite cache
    await sqliteStorage.insertRecord("distributed_held_bills", holdId, {
      ...record,
      cart_payload: JSON.stringify(cartPayload),
    });

    // 2. Broadcast online to Cloud Backend if reachable
    try {
      await fetch(`${this.getEffectiveBaseUrl()}/api/held-bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(record),
      });
    } catch {
      // Degraded offline: already saved in local cache
    }

    return holdId;
  }

  async listHeldBills(): Promise<DistributedHeldBill[]> {
    // Attempt live fetch from server
    try {
      const res = await fetch(`${this.getEffectiveBaseUrl()}/api/held-bills`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.held_bills)) {
          // Sync server held bills to local cache
          for (const b of data.held_bills) {
            await sqliteStorage.insertRecord("distributed_held_bills", b.id, {
              ...b,
              cart_payload: typeof b.cart_payload === "string" ? b.cart_payload : JSON.stringify(b.cart_payload),
            });
          }
          return data.held_bills.map((b: any) => ({
            ...b,
            cart_payload: typeof b.cart_payload === "string" ? JSON.parse(b.cart_payload) : b.cart_payload,
          }));
        }
      }
    } catch {
      // Offline fallback: read from local cache
    }

    const raw = await sqliteStorage.findAll<any>("distributed_held_bills");
    return (raw || [])
      .filter((b) => b.status === "held")
      .map((b) => ({
        id: b.id,
        held_by_counter_id: b.held_by_counter_id,
        held_by_counter_name: b.held_by_counter_name,
        held_by_user_name: b.held_by_user_name,
        customer_name: b.customer_name || "Walk-in Customer",
        items_count: Number(b.items_count || 0),
        grand_total: Number(b.grand_total || 0),
        held_at: Number(b.held_at),
        cart_payload: typeof b.cart_payload === "string" ? JSON.parse(b.cart_payload) : b.cart_payload,
        status: b.status,
      }))
      .sort((a, b) => b.held_at - a.held_at);
  }

  async claimHeldBill(
    holdId: string,
    claimingCounterId: string
  ): Promise<{ success: boolean; bill?: DistributedHeldBill; error?: string }> {
    // 1. Try online claim first (prevents race condition across counters)
    try {
      const res = await fetch(`${this.getEffectiveBaseUrl()}/api/held-bills/${holdId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ counter_id: claimingCounterId }),
      });

      if (res.status === 409) {
        const data = await res.json();
        const msg = data.message || "This bill has already been recalled or claimed by another counter.";
        return {
          success: false,
          error: msg.includes("recalled") ? msg : msg.replace("already been claimed", "already been recalled or claimed"),
        };
      }

      if (res.ok) {
        const data = await res.json();
        const serverBill = data.held_bill;
        const parsed = {
          ...serverBill,
          cart_payload: typeof serverBill.cart_payload === "string" ? JSON.parse(serverBill.cart_payload) : serverBill.cart_payload,
        };
        await sqliteStorage.insertRecord("distributed_held_bills", holdId, {
          ...serverBill,
          cart_payload: JSON.stringify(parsed.cart_payload),
        });
        return { success: true, bill: parsed };
      }
    } catch {
      // Offline fallback: check local cache
    }

    const raw = await sqliteStorage.findById<any>("distributed_held_bills", holdId);
    if (!raw) {
      return { success: false, error: "Held bill not found" };
    }

    if (raw.status !== "held") {
      return {
        success: false,
        error: `Bill has already been recalled or claimed by counter ${raw.claimed_by_counter_id || "another"}`,
      };
    }

    const updated = {
      ...raw,
      status: "claimed",
      claimed_by_counter_id: claimingCounterId,
      claimed_at: Date.now(),
    };

    await sqliteStorage.insertRecord("distributed_held_bills", holdId, updated);

    return {
      success: true,
      bill: {
        ...updated,
        cart_payload: typeof updated.cart_payload === "string" ? JSON.parse(updated.cart_payload) : updated.cart_payload,
      },
    };
  }

  async releaseOrCancelHold(holdId: string): Promise<void> {
    try {
      await fetch(`${this.getEffectiveBaseUrl()}/api/held-bills/${holdId}`, { method: "DELETE" });
    } catch {}

    const existing = await sqliteStorage.findById<any>("distributed_held_bills", holdId);
    if (existing) {
      await sqliteStorage.insertRecord("distributed_held_bills", holdId, {
        ...existing,
        status: "cancelled",
        updated_at: Date.now(),
      });
    }
  }
}

export const distributedHeldBillService = new DistributedHeldBillService();
