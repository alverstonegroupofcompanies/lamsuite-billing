/**
 * Central HTTP client for the LamSuite Billing Web Admin Panel
 */

declare global {
  interface Window {
    __ENV__?: {
      VITE_API_BASE_URL?: string;
      VITE_WS_URL?: string;
      VITE_LEGACY_API_URL?: string;
    };
  }
}

const rawApiBase =
  (typeof window !== "undefined" && window.__ENV__?.VITE_API_BASE_URL) ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

export const API_BASE = rawApiBase
  ? (rawApiBase.endsWith("/api") ? rawApiBase.replace(/\/+$/, "") : `${rawApiBase.replace(/\/+$/, "")}/api`)
  : "/api";

/**
 * The legacy v1 panel is a separate install from this admin app and the only host that
 * serves /api/sync/pull. The portal answers that path with its own index.html, so a
 * migration aimed at the wrong host fails as a bare network error — never derive this
 * from API_BASE.
 */
export const LEGACY_PANEL_URL: string = (
  (typeof window !== "undefined" && window.__ENV__?.VITE_LEGACY_API_URL) ||
  import.meta.env.VITE_LEGACY_API_URL ||
  "https://admin.lamstonehealthcare.com"
)
  .trim()
  .replace(/\/+$/, "");

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

  const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (storeId === "all") {
    headers["X-Store-Scope"] = "all";
  } else if (storeId) {
    headers["X-Store-Id"] = storeId;
  }
  if (impersonatorId) {
    headers["X-Impersonator-Id"] = impersonatorId;
  }

  // A multipart body has to keep the boundary the browser generated for it — naming a
  // JSON type over it is how an upload arrives as an empty file. Everything else is JSON.
  if (!isMultipart && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  let data: any;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      try {
        data = await response.text();
      } catch {
        data = null;
      }
    }
  } else {
    data = await response.text();
  }

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

export async function downloadFile(endpoint: string, fallbackName: string): Promise<void> {
  const token = localStorage.getItem("admin_token");
  const storeId = localStorage.getItem("admin_store_id");

  const headers: Record<string, string> = { Accept: "*/*" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (storeId === "all") {
    headers["X-Store-Scope"] = "all";
  } else if (storeId) {
    headers["X-Store-Id"] = storeId;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    let message = `HTTP Error ${response.status}`;
    try {
      const data = await response.json();
      message = data?.message || message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, response.status);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] || fallbackName;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
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
  /** Sends a file the browser holds; the body must stay FormData. */
  upload: <T = any>(url: string, form: FormData) =>
    apiRequest<T>(url, { method: "POST", body: form }),
  put: <T = any>(url: string, body?: any) =>
    apiRequest<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(url: string, body?: any) =>
    apiRequest<T>(url, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
