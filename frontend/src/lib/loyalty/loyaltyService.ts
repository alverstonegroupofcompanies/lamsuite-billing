import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeDeviceService } from "../auth/storeDeviceService";

export interface LoyaltyProgramInfo {
  is_active: boolean;
  earn_points_per_100: number;
  redeem_value_per_point: number;
  min_redeem_points: number;
  expiry_days?: number | null;
}

export interface LoyaltyBalance {
  balance: number;
  program: LoyaltyProgramInfo;
}

export interface CouponValidation {
  code: string;
  description?: string | null;
  discount_type: "percent" | "amount";
  value: number;
  min_bill_amount: number;
  max_discount?: number | null;
}

/**
 * B8b: the counter redeems a coupon, so its device token authorises the call.
 */
async function headers(): Promise<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(await storeDeviceService.getDeviceAuthHeaders()),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/api${path}`, { ...init, headers: await headers(), signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.message || `Request failed (${res.status})`);
    }
    return body as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

class LoyaltyService {
  async getBalance(customerId: string | number): Promise<LoyaltyBalance> {
    return request<LoyaltyBalance>(`/loyalty/balance?customer_id=${encodeURIComponent(String(customerId))}`);
  }

  async validateCoupon(
    code: string,
    billAmount: number,
    customerId?: string | number | null
  ): Promise<{ coupon: CouponValidation; discount_amount: number }> {
    return request<{ coupon: CouponValidation; discount_amount: number }>("/coupons/validate", {
      method: "POST",
      body: JSON.stringify({ code, bill_amount: billAmount, customer_id: customerId ?? null }),
    });
  }

  async redeemCoupon(input: {
    code: string;
    invoiceId: string | number;
    billAmount: number;
    customerId?: string | number | null;
  }): Promise<{ discount_amount: number; already_redeemed?: boolean }> {
    return request("/coupons/redeem", {
      method: "POST",
      body: JSON.stringify({
        code: input.code,
        invoice_id: String(input.invoiceId),
        bill_amount: input.billAmount,
        customer_id: input.customerId ?? null,
      }),
    });
  }

  async redeemPoints(input: {
    customerId: string | number;
    points: number;
    invoiceId?: string | number | null;
    billAmount?: number;
  }): Promise<{ discount_amount: number; points_redeemed: number; balance: number }> {
    return request("/loyalty/redeem", {
      method: "POST",
      body: JSON.stringify({
        customer_id: input.customerId,
        points: input.points,
        invoice_id: input.invoiceId != null ? String(input.invoiceId) : null,
        bill_amount: input.billAmount ?? null,
      }),
    });
  }

  async earnPoints(input: {
    invoiceId: string | number;
    customerId?: string | number | null;
    billAmount: number;
  }): Promise<{ points_earned: number; balance: number }> {
    return request("/loyalty/earn", {
      method: "POST",
      body: JSON.stringify({
        invoice_id: String(input.invoiceId),
        customer_id: input.customerId ?? null,
        bill_amount: input.billAmount,
      }),
    });
  }
}

export const loyaltyService = new LoyaltyService();
