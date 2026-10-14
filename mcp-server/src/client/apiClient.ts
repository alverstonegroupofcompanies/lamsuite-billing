import type { ServerConfig } from "../config.js";
import {
  McpToolError,
  NotFoundError,
  PermissionDeniedError,
  StoreOfflineError,
  TimeoutError,
  ValidationError,
} from "./errors.js";
import type {
  CustomerData,
  InvoiceData,
  PaginatedResponse,
  ProductBatchData,
  ProductData,
  PurchaseData,
  SalesSummaryData,
  StoreProfile,
  SupplierData,
} from "./types.js";

export class LamSuiteApiClient {
  private config: ServerConfig;
  private token: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.token = config.apiToken;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async getAuthToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (this.config.email && this.config.password) {
      try {
        const res = await this.request<{ token: string }>("/login", {
          method: "POST",
          body: JSON.stringify({
            email: this.config.email,
            password: this.config.password,
            store_code: this.config.storeCode,
          }),
          skipAuth: true,
        });
        if (res && res.token) {
          this.token = res.token;
          return this.token;
        }
      } catch (err) {
        console.warn("[ApiClient] Auto-login failed:", err);
      }
    }

    // Default to a fallback token so backend receives bearer token header
    return "lamsuite_api_key_default";
  }

  public async request<T>(
    endpoint: string,
    options: RequestInit & { skipAuth?: boolean } = {}
  ): Promise<T> {
    const url = `${this.config.apiUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Store-Id": String(this.config.storeId),
      "X-User-Role": this.config.role,
      ...(options.headers as Record<string, string>),
    };

    if (!options.skipAuth) {
      const token = await this.getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData: any = {};
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }

        const msg = errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;

        if (response.status === 401 || response.status === 403) {
          throw new PermissionDeniedError(
            `Permission denied by LamSuite backend: ${msg}`,
            errorData
          );
        } else if (response.status === 404) {
          throw new NotFoundError(msg, errorData);
        } else if (response.status === 422) {
          const validationDetails = errorData.errors ? JSON.stringify(errorData.errors) : "";
          throw new ValidationError(
            `Validation failed on LamSuite backend: ${msg} ${validationDetails}`.trim(),
            errorData
          );
        } else {
          throw new McpToolError(
            `LamSuite backend returned error (${response.status}): ${msg}`,
            "API_ERROR",
            response.status,
            errorData
          );
        }
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err instanceof McpToolError) {
        throw err;
      }

      if (err.name === "AbortError") {
        throw new TimeoutError(
          `Request to LamSuite backend timed out after ${this.config.timeoutMs}ms.`
        );
      }

      if (
        err.code === "ECONNREFUSED" ||
        err.message?.includes("fetch failed") ||
        err.message?.includes("connect ECONNREFUSED")
      ) {
        throw new StoreOfflineError(
          `Store backend is offline or unreachable at ${this.config.apiUrl}. Please verify the LamSuite server is running.`
        );
      }

      throw new McpToolError(`Unexpected communication error: ${err.message}`);
    }
  }

  // --- Store Profile ---
  async getStore(): Promise<StoreProfile> {
    return this.request<StoreProfile>("/store");
  }

  async updateStore(data: Partial<StoreProfile>): Promise<any> {
    return this.request("/store", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // --- Products / Items ---
  async getProducts(params?: {
    query?: string;
    category_id?: string;
    brand_id?: string;
    is_active?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<ProductData>> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.category_id) q.set("category_id", params.category_id);
    if (params?.brand_id) q.set("brand_id", params.brand_id);
    if (params?.is_active !== undefined) q.set("is_active", String(params.is_active));
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));

    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<PaginatedResponse<ProductData>>(`/products${qs}`);
  }

  async getProduct(idOrBarcode: string): Promise<ProductData> {
    return this.request<ProductData>(`/products/${encodeURIComponent(idOrBarcode)}`);
  }

  async createProduct(product: Partial<ProductData>): Promise<ProductData> {
    return this.request<ProductData>("/products", {
      method: "POST",
      body: JSON.stringify(product),
    });
  }

  async updateProduct(id: string, product: Partial<ProductData>): Promise<ProductData> {
    return this.request<ProductData>(`/products/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(product),
    });
  }

  async addProductBatch(productId: string, batch: Partial<ProductBatchData>): Promise<ProductBatchData> {
    return this.request<ProductBatchData>(`/products/${encodeURIComponent(productId)}/batches`, {
      method: "POST",
      body: JSON.stringify(batch),
    });
  }

  async getLowStock(threshold?: number): Promise<ProductData[]> {
    const qs = threshold ? `?threshold=${threshold}` : "";
    return this.request<ProductData[]>(`/stock/products/low-stock${qs}`);
  }

  async getNearExpiry(thresholdDays: number = 60): Promise<ProductBatchData[]> {
    return this.request<ProductBatchData[]>(`/stock/batches/near-expiry?threshold_days=${thresholdDays}`);
  }

  async getExpiredStock(): Promise<ProductBatchData[]> {
    return this.request<ProductBatchData[]>("/stock/batches/near-expiry?threshold_days=0");
  }

  // --- Customers ---
  async getCustomers(params?: { query?: string; page?: number; limit?: number }): Promise<PaginatedResponse<CustomerData>> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<PaginatedResponse<CustomerData>>(`/customers${qs}`);
  }

  async getCustomer(idOrPhone: string): Promise<CustomerData> {
    return this.request<CustomerData>(`/customers/${encodeURIComponent(idOrPhone)}`);
  }

  async createCustomer(customer: Partial<CustomerData>): Promise<CustomerData> {
    return this.request<CustomerData>("/customers", {
      method: "POST",
      body: JSON.stringify(customer),
    });
  }

  // --- Suppliers ---
  async getSuppliers(params?: { query?: string; page?: number; limit?: number }): Promise<PaginatedResponse<SupplierData>> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<PaginatedResponse<SupplierData>>(`/suppliers${qs}`);
  }

  async getSupplier(id: string): Promise<SupplierData> {
    return this.request<SupplierData>(`/suppliers/${encodeURIComponent(id)}`);
  }

  // --- Invoices ---
  async getInvoices(params?: {
    query?: string;
    start_date?: string;
    end_date?: string;
    payment_mode?: string;
    customer_id?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<InvoiceData>> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    if (params?.payment_mode) q.set("payment_mode", params.payment_mode);
    if (params?.customer_id) q.set("customer_id", params.customer_id);
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));

    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<PaginatedResponse<InvoiceData>>(`/invoices${qs}`);
  }

  async getInvoice(idOrNumber: string): Promise<InvoiceData> {
    return this.request<InvoiceData>(`/invoices/${encodeURIComponent(idOrNumber)}`);
  }

  async createInvoice(invoice: any): Promise<InvoiceData> {
    return this.request<InvoiceData>("/invoices", {
      method: "POST",
      body: JSON.stringify(invoice),
    });
  }

  async cancelInvoice(id: string, reason: string): Promise<{ success: boolean; status: string }> {
    return this.request<{ success: boolean; status: string }>(`/invoices/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  // --- Purchases ---
  async getPurchases(params?: {
    query?: string;
    supplier_id?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<PurchaseData>> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.supplier_id) q.set("supplier_id", params.supplier_id);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<PaginatedResponse<PurchaseData>>(`/purchases${qs}`);
  }

  async getPurchase(id: string): Promise<PurchaseData> {
    return this.request<PurchaseData>(`/purchases/${encodeURIComponent(id)}`);
  }

  async createPurchase(purchase: any): Promise<PurchaseData> {
    return this.request<PurchaseData>("/purchases", {
      method: "POST",
      body: JSON.stringify(purchase),
    });
  }

  // --- Returns & Adjustments ---
  async getReturns(params?: { type?: string; start_date?: string; end_date?: string; page?: number; limit?: number }): Promise<any> {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request(`/returns${qs}`);
  }

  async recordCustomerPayment(payment: any): Promise<any> {
    return this.request("/payments/customer", {
      method: "POST",
      body: JSON.stringify(payment),
    });
  }

  async recordSupplierPayment(payment: any): Promise<any> {
    return this.request("/payments/supplier", {
      method: "POST",
      body: JSON.stringify(payment),
    });
  }

  async createSalesReturn(data: any): Promise<any> {
    return this.request("/returns/sales", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createPurchaseReturn(data: any): Promise<any> {
    return this.request("/returns/purchase", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createStockAdjustment(adjustment: any): Promise<any> {
    return this.request("/stock/adjustments", {
      method: "POST",
      body: JSON.stringify(adjustment),
    });
  }

  async getDailyCollection(startDate?: string, endDate?: string, counterId?: string): Promise<SalesSummaryData> {
    const q = new URLSearchParams();
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    if (counterId) q.set("counter_id", counterId);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request<SalesSummaryData>(`/reports/daily-collection${qs}`);
  }

  async getGstr1Report(startDate?: string, endDate?: string, stateCode?: string): Promise<any> {
    const q = new URLSearchParams();
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    if (stateCode) q.set("store_state_code", stateCode);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request(`/reports/gstr-1${qs}`);
  }

  async getHsnSummaryReport(startDate?: string, endDate?: string): Promise<any> {
    const q = new URLSearchParams();
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this.request(`/reports/hsn-summary${qs}`);
  }

  async getCustomerAging(partyType: string = "customer"): Promise<any> {
    return this.request(`/reports/customer-aging?party_type=${partyType}`);
  }

  async getTopSellingItems(period?: string, limit: number = 10): Promise<any> {
    const q = new URLSearchParams();
    if (period) q.set("period", period);
    q.set("limit", String(limit));
    return this.request(`/reports/top-selling?${q.toString()}`);
  }

  async getCashBook(date?: string, tender?: string): Promise<any> {
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    if (tender) q.set("tender", tender);
    return this.request(`/reports/cash-book?${q.toString()}`);
  }

  async getDailySummary(date?: string): Promise<any> {
    const qs = date ? `?date=${date}` : "";
    return this.request(`/reports/daily-summary${qs}`);
  }

  async getProfitReport(startDate?: string, endDate?: string, groupBy?: string): Promise<any> {
    const q = new URLSearchParams();
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    if (groupBy) q.set("group_by", groupBy);
    return this.request(`/reports/profit?${q.toString()}`);
  }

  async getStockLedger(productId?: string, batchId?: string, startDate?: string, endDate?: string, limit: number = 20): Promise<any> {
    const q = new URLSearchParams();
    if (productId) q.set("product_id", productId);
    if (batchId) q.set("batch_id", batchId);
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    q.set("limit", String(limit));
    return this.request(`/stock/ledger?${q.toString()}`);
  }

  async getStockBalance(query?: string, categoryId?: string, location?: string, limit: number = 20): Promise<any> {
    const q = new URLSearchParams();
    if (query) q.set("query", query);
    if (categoryId) q.set("category_id", categoryId);
    if (location) q.set("location", location);
    q.set("limit", String(limit));
    return this.request(`/stock/balance?${q.toString()}`);
  }
}
