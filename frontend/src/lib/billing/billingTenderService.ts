export interface PaymentTenderLine {
  mode: "Cash" | "UPI" | "Card" | "Credit" | "Cheque";
  amount: number;
  reference_no?: string; // UPI txn id, card last 4, cheque no
}

export interface HeldBill {
  id: string;
  sequence: number;
  customer_name?: string;
  items_count: number;
  grand_total: number;
  held_at: number;
  cart_payload: Record<string, unknown>;
}

let holdCounter = 0;

export class BillingTenderService {
  private heldBills = new Map<string, HeldBill>();

  calculateTenderBalance(grandTotal: number, payments: PaymentTenderLine[]): {
    totalPaid: number;
    balanceDue: number;
    isFullyPaid: boolean;
  } {
    const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const roundedPaid = Math.round((totalPaid + Number.EPSILON) * 100) / 100;
    const balanceDue = Math.max(0, Math.round((grandTotal - roundedPaid + Number.EPSILON) * 100) / 100);

    return {
      totalPaid: roundedPaid,
      balanceDue,
      isFullyPaid: balanceDue <= 0.001,
    };
  }

  holdBill(cartPayload: Record<string, unknown>, itemsCount: number, grandTotal: number, customerName?: string): string {
    holdCounter += 1;
    const holdId = `hold_${Date.now()}_${holdCounter}_${Math.random().toString(16).slice(2, 6)}`;
    const heldBill: HeldBill = {
      id: holdId,
      sequence: holdCounter,
      customer_name: customerName || "Walk-in Customer",
      items_count: itemsCount,
      grand_total: grandTotal,
      held_at: Date.now(),
      cart_payload: { ...cartPayload },
    };
    this.heldBills.set(holdId, heldBill);
    return holdId;
  }

  listHeldBills(): HeldBill[] {
    return Array.from(this.heldBills.values()).sort((a, b) => b.sequence - a.sequence);
  }

  recallBill(holdId: string): HeldBill | null {
    const bill = this.heldBills.get(holdId);
    if (bill) {
      this.heldBills.delete(holdId);
      return bill;
    }
    return null;
  }

  clearHeldBills(): void {
    this.heldBills.clear();
  }
}

export const billingTenderService = new BillingTenderService();
