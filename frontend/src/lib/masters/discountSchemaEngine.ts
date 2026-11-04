import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";

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

export interface DiscountRule {
  rule_id: string;
  name: string;
  rule_type: "percentage" | "buy_x_get_y" | "customer_type";
  discount_percent: number;
  min_quantity?: number;
  free_quantity?: number;
  is_active: boolean;
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
  private activeRules: DiscountRule[] = [
    {
      rule_id: "rule_def_01",
      name: "Default Wholesale 5%",
      rule_type: "percentage",
      discount_percent: 5,
      min_quantity: 1,
      is_active: true,
    },
  ];

  async registerRule(rule: DiscountRule): Promise<void> {
    const existingIdx = this.activeRules.findIndex((r) => r.rule_id === rule.rule_id);
    if (existingIdx >= 0) {
      this.activeRules[existingIdx] = rule;
    } else {
      this.activeRules.push(rule);
    }

    try {
      await sqliteStorage.insertRecord("master_lookups", rule.rule_id, {
        id: rule.rule_id,
        type: "discount_schema",
        name: rule.name,
        code: rule.rule_id,
        config: JSON.stringify({
          rule_type: rule.rule_type,
          discount_percent: rule.discount_percent,
          min_quantity: rule.min_quantity,
          free_quantity: rule.free_quantity,
        }),
        is_active: rule.is_active ? 1 : 0,
      });

      await syncQueueService.enqueue("discount_schema", rule.rule_id, "update", {
        type: "discount_schema",
        name: rule.name,
        code: rule.rule_id,
        config: {
          rule_type: rule.rule_type,
          discount_percent: rule.discount_percent,
          min_quantity: rule.min_quantity,
          free_quantity: rule.free_quantity,
        },
        is_active: rule.is_active,
      });
    } catch {
      // offline / in-memory fallback
    }
  }

  async deleteRule(ruleId: string): Promise<void> {
    this.activeRules = this.activeRules.filter((r) => r.rule_id !== ruleId);
    try {
      await sqliteStorage.deleteRecord("master_lookups", ruleId);
      await syncQueueService.enqueue("discount_schema", ruleId, "delete", { rule_id: ruleId });
    } catch {
      // offline / in-memory fallback
    }
  }

  async loadRulesFromDb(): Promise<DiscountRule[]> {
    try {
      const records = await sqliteStorage.findAll<any>("master_lookups");
      const rules = records
        .filter((r) => r && r.type === "discount_schema")
        .map((r) => {
          let config: any = {};
          if (typeof r.config === "string") {
            try { config = JSON.parse(r.config); } catch {}
          } else if (r.config && typeof r.config === "object") {
            config = r.config;
          }
          return {
            rule_id: String(r.id || r.code),
            name: String(r.name),
            rule_type: (config.rule_type || "percentage") as "percentage" | "buy_x_get_y" | "customer_type",
            discount_percent: Number(config.discount_percent || 0),
            min_quantity: Number(config.min_quantity || 1),
            free_quantity: Number(config.free_quantity || 0),
            is_active: r.is_active === 1 || r.is_active === true,
          };
        });

      if (rules.length > 0) {
        for (const rule of rules) {
          const idx = this.activeRules.findIndex((ar) => ar.rule_id === rule.rule_id);
          if (idx >= 0) {
            this.activeRules[idx] = rule;
          } else {
            this.activeRules.push(rule);
          }
        }
      }
    } catch {
      // fallback to initial
    }
    return this.getAllRules();
  }

  getAllRules(): DiscountRule[] {
    return [...this.activeRules];
  }

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
