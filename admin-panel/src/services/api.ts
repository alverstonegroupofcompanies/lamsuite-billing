/**
 * Central HTTP client for the LamSuite Billing Web Admin Panel
 */

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("admin_token");
  const storeId = localStorage.getItem("admin_store_id");
  const impersonatorId = localStorage.getItem("impersonator_id");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (storeId) {
    headers["X-Store-Id"] = storeId;
  }
  if (impersonatorId) {
    headers["X-Impersonator-Id"] = impersonatorId;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401 && !endpoint.includes("/login")) {
      // Session expired
      localStorage.removeItem("admin_token");
      window.dispatchEvent(new CustomEvent("session_expired", { detail: data }));
    }
    throw new ApiError(data?.message || `HTTP Error ${response.status}`, response.status, data);
  }

  return data as T;
}

export const api = {
  get: <T = any>(url: string, params?: Record<string, any>) => {
    let endpoint = url;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, String(value));
        }
      });
      const qs = searchParams.toString();
      if (qs) endpoint += `?${qs}`;
    }
    return apiRequest<T>(endpoint, { method: "GET" });
  },
  post: <T = any>(url: string, body?: any) =>
    apiRequest<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(url: string, body?: any) =>
    apiRequest<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(url: string) =>
    apiRequest<T>(url, { method: "DELETE" }),
};
