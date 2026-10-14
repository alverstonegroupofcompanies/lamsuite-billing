import { sqliteStorage } from "../db/sqliteStorage";

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
      cart_payload: JSON.stringify(cartPayload),
      status: "held",
    };

    await sqliteStorage.insertRecord("distributed_held_bills", holdId, record);
    return holdId;
  }

  async listHeldBills(): Promise<DistributedHeldBill[]> {
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
    const raw = await sqliteStorage.findById<any>("distributed_held_bills", holdId);
    if (!raw) {
      return { success: false, error: "Held bill not found" };
    }

    if (raw.status !== "held") {
      return {
        success: false,
        error: `Held bill has already been recalled or processed by ${raw.claimed_by_counter_id || "another counter"}.`,
      };
    }

    // Atomic claim transition
    raw.status = "claimed";
    raw.claimed_by_counter_id = claimingCounterId;
    raw.claimed_at = Date.now();
    await sqliteStorage.insertRecord("distributed_held_bills", holdId, raw);

    return {
      success: true,
      bill: {
        id: raw.id,
        held_by_counter_id: raw.held_by_counter_id,
        held_by_counter_name: raw.held_by_counter_name,
        held_by_user_name: raw.held_by_user_name,
        customer_name: raw.customer_name,
        items_count: Number(raw.items_count),
        grand_total: Number(raw.grand_total),
        held_at: Number(raw.held_at),
        cart_payload: typeof raw.cart_payload === "string" ? JSON.parse(raw.cart_payload) : raw.cart_payload,
        status: "claimed",
        claimed_by_counter_id: claimingCounterId,
        claimed_at: raw.claimed_at,
      },
    };
  }

  async cancelHeldBill(holdId: string): Promise<boolean> {
    const raw = await sqliteStorage.findById<any>("distributed_held_bills", holdId);
    if (!raw) return false;
    raw.status = "cancelled";
    await sqliteStorage.insertRecord("distributed_held_bills", holdId, raw);
    return true;
  }
}

export const distributedHeldBillService = new DistributedHeldBillService();
