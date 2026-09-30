export interface DiscountSchema {
  id: string;
  name: string;
  isActive: boolean;
  discountType: "percent" | "amount" | "buy_x_get_y";
  value: number; // percentage or fixed amount
  buyQty?: number;
  getQty?: number;
  productId?: string;
  categoryId?: string;
  quantityMin?: number;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface CartLineItem {
  productId: string;
  categoryId?: string;
  qty: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  discountManual?: boolean;
}

export class DiscountSchemaEngine {
  evaluateLineDiscount(
    line: CartLineItem,
    schemas: DiscountSchema[],
    currentDateYmd: string = new Date().toISOString().slice(0, 10)
  ): { discountPercent: number; discountAmount: number; appliedSchemaId?: string } {
    // If the cashier manually altered the discount, auto-schemas MUST NOT overwrite it
    if (line.discountManual) {
      return {
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
      };
    }

    const gross = line.qty * line.unitPrice;
    if (gross <= 0) return { discountPercent: 0, discountAmount: 0 };

    for (const s of schemas) {
      if (!s.isActive) continue;

      // Date window check
      if (s.startDate && currentDateYmd < s.startDate) continue;
      if (s.endDate && currentDateYmd > s.endDate) continue;

      // Product or Category target check
      if (s.productId && s.productId !== line.productId) continue;
      if (s.categoryId && s.categoryId !== line.categoryId) continue;

      // Minimum quantity threshold
      if (s.quantityMin && line.qty < s.quantityMin) continue;

      // Evaluate discount rule
      if (s.discountType === "percent") {
        const percent = Math.min(100, Math.max(0, s.value));
        const amount = Math.round((gross * (percent / 100) + Number.EPSILON) * 100) / 100;
        return { discountPercent: percent, discountAmount: amount, appliedSchemaId: s.id };
      }

      if (s.discountType === "amount") {
        const amount = Math.min(gross, Math.max(0, s.value));
        const percent = Math.round(((amount / gross) * 100 + Number.EPSILON) * 100) / 100;
        return { discountPercent: percent, discountAmount: amount, appliedSchemaId: s.id };
      }

      if (s.discountType === "buy_x_get_y" && s.buyQty && s.getQty) {
        const setSize = s.buyQty + s.getQty;
        const completeSets = Math.floor(line.qty / setSize);
        if (completeSets > 0) {
          const freeUnits = completeSets * s.getQty;
          const freeAmount = freeUnits * line.unitPrice;
          const percent = Math.round(((freeAmount / gross) * 100 + Number.EPSILON) * 100) / 100;
          return { discountPercent: percent, discountAmount: freeAmount, appliedSchemaId: s.id };
        }
      }
    }

    return { discountPercent: 0, discountAmount: 0 };
  }
}

export const discountSchemaEngine = new DiscountSchemaEngine();
