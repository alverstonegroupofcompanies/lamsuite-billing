import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";

export interface SalesOrderLineInput {
  product_id?: string | number | null;
  product_name: string;
  hsn_code?: string | null;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent?: number;
}

export interface CreateSalesOrderInput {
  customer_id?: string | number | null;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  order_date?: string;
  expected_delivery_date?: string | null;
  notes?: string;
  items: SalesOrderLineInput[];
}

export interface SalesOrderSummary {
  id: number;
  order_number: string;
  order_date: string;
  expected_delivery_date?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  status: string;
  grand_total: number;
  items_count: number;
}

export interface SalesOrderItemRecord {
  id: number;
  product_id?: number | null;
  product_name: string;
  hsn_code?: string | null;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent?: number;
  total_amount?: number;
  remaining_base_units?: number;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  customer_phone?: string | null;
  customer_gstin?: string | null;
  place_of_supply?: string | null;
  discount_total: number;
  tax_total: number;
  notes?: string | null;
  items: SalesOrderItemRecord[];
}

/** Orders still awaiting confirmation / dispatch can be recalled into the POS cart. */
export const OPEN_SALES_ORDER_STATUSES = ["draft", "confirmed", "partially_fulfilled"] as const;

export function isOpenSalesOrderStatus(status: string): boolean {
  return (OPEN_SALES_ORDER_STATUSES as readonly string[]).includes(status);
}

function token(): string | null {
  try {
    return localStorage.getItem("staff_token");
  } catch {
    return null;
  }
}

function headers(): Record<string, string> {
  const storeId = String(storeRegistryService.getActiveStore()?.id || "1");
  const bearer = token();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Store-Id": storeId,
    "Store-Id": storeId,
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/api${path}`, { ...init, headers: headers(), signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.message || `Request failed (${res.status})`);
    }
    return body as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

class SalesOrderService {
  async createOrder(input: CreateSalesOrderInput): Promise<{ order: SalesOrderSummary }> {
    return request<{ order: SalesOrderSummary }>("/sales-orders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listOpenOrders(customerId?: string | number | null): Promise<SalesOrderSummary[]> {
    const res = await request<{ orders: SalesOrderSummary[] }>("/sales-orders?per_page=100");
    const orders = (res.orders || []).filter((o) => isOpenSalesOrderStatus(o.status));
    return customerId
      ? orders.filter((o) => String(o.customer_id || "") === String(customerId))
      : orders;
  }

  async getOrder(id: number | string): Promise<SalesOrderDetail | null> {
    const res = await request<{ success?: boolean; order: SalesOrderDetail }>(`/sales-orders/${id}`);
    return res.order || null;
  }
}

export const salesOrderService = new SalesOrderService();
