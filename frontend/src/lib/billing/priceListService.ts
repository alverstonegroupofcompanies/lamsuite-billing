import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";

export interface ResolvedPriceListItem {
  product_id: number | string;
  rate: number;
  discount_percent: number;
  min_qty: number;
}

export interface ResolvedPriceList {
  list: { id: number; name: string; priority?: number; valid_from?: string | null; valid_to?: string | null } | null;
  items: ResolvedPriceListItem[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

class PriceListService {
  private cache = new Map<string, { at: number; value: ResolvedPriceList | null }>();

  /** Last successfully resolved price list for a customer, independent of TTL (offline fallback). */
  getCached(customerId: string): ResolvedPriceList | null {
    return this.cache.get(String(customerId))?.value ?? null;
  }

  async resolveForCustomer(customerId: string, options?: { force?: boolean }): Promise<ResolvedPriceList | null> {
    const key = String(customerId || "").trim();
    if (!key) return null;

    const cached = this.cache.get(key);
    if (!options?.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    try {
      const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
      const storeId = String(storeRegistryService.getActiveStore()?.id || "1");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(
        `${baseUrl}/api/price-lists/resolve?customer_id=${encodeURIComponent(key)}`,
        {
          headers: {
            Accept: "application/json",
            "X-Store-Id": storeId,
            "Store-Id": storeId,
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!res.ok) {
        return this.getCached(key);
      }
      const body = (await res.json()) as ResolvedPriceList & { success?: boolean };
      const value: ResolvedPriceList = {
        list: body?.list ?? null,
        items: Array.isArray(body?.items) ? body.items : [],
      };
      this.cache.set(key, { at: Date.now(), value });
      return value;
    } catch {
      return this.getCached(key);
    }
  }

  invalidate(customerId?: string) {
    if (customerId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(String(customerId));
  }
}

export const priceListService = new PriceListService();
