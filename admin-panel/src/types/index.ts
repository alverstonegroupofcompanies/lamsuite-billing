export type UserRole =
  | "super_admin"
  | "store_owner"
  | "manager"
  | "cashier"
  | "operator"
  | "pharmacist"
  | "accountant"
  | "support"
  | "admin";

export interface User {
  id: number;
  name: string;
  email: string;
  username?: string;
  role: UserRole;
  store_id: number | null;
  allowed_store_ids?: number[];
  permissions?: Record<string, string[] | boolean>;
  totp_enabled: boolean;
  is_biometric_enabled?: boolean;
  idle_timeout_minutes: number;
  max_failed_logins?: number;
  failed_login_attempts?: number;
  locked_until?: string | null;
  is_locked?: boolean;
  has_pin?: boolean;
  store?: Store;
}

export interface Store {
  id: number;
  name: string;
  code: string;
  activation_key?: string;
  phone?: string;
  email?: string;
  address?: string;
  state_code: string;
  gstin?: string;
  drug_license_numbers?: string[];
  fssai_no?: string;
  tax_mode: "inclusive" | "exclusive";
  invoice_prefix: string;
  is_active: boolean;
  license_plan: string;
  license_expires_at?: string;
  enabled_menu_items?: string[];
  feature_flags?: Record<string, boolean>;
  version: number;
  users_count?: number;
  devices_count?: number;
  products_count?: number;
  invoices_count?: number;
}

export interface Device {
  id: number;
  store_id: number;
  device_name: string;
  device_uuid: string;
  app_version: string;
  status: "active" | "revoked" | "pending";
  ip_address?: string;
  last_seen_at?: string;
  last_sync_at?: string;
  force_resync: boolean;
  revoke_reason?: string;
  store?: { id: number; name: string; code: string };
}

export interface ProductBatch {
  id: number;
  store_id: number;
  product_id: number;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  stock_qty: number;
  mrp: number;
  purchase_rate: number;
  selling_rate: number;
  rack_location?: string;
  shelf_location?: string;
  is_expired?: boolean;
  days_remaining?: number;
  version: number;
  product?: Product;
  store?: { id: number; name: string };
}

export interface Product {
  id: number;
  store_id: number;
  barcode?: string;
  name: string;
  print_name?: string;
  generic_name?: string;
  hsn_sac_code: string;
  category_id?: string;
  brand_id?: string;
  manufacturer_id?: string;
  unit_id?: string;
  mrp: number;
  sel_rate: number;
  ptr?: number;
  pts?: number;
  gst_percent: number;
  units_per_pack: number;
  rack_location?: string;
  shelf_location?: string;
  reorder_level: number;
  current_stock: number;
  is_active: boolean;
  version: number;
  batches?: ProductBatch[];
}

export interface Party {
  id: number;
  store_id: number;
  type: "customer" | "supplier" | "doctor" | "patient";
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  state_code?: string;
  credit_limit: number;
  opening_balance: number;
  current_balance: number;
  reg_no?: string;
  is_active: boolean;
  version: number;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id?: number;
  product_name: string;
  batch_no?: string;
  expiry_date?: string;
  qty: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  gst_percent: number;
  tax_amount: number;
  total_amount: number;
}

export interface Invoice {
  id: number;
  store_id: number;
  module_key: string;
  invoice_number: string;
  invoice_date: string;
  due_date?: string;
  customer_id?: number;
  customer_name: string;
  customer_gstin?: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_mode: string;
  status: "issued" | "cancelled";
  cancel_reason?: string;
  cancelled_at?: string;
  cancelled_by?: number;
  patient_name?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  version: number;
  items?: InvoiceItem[];
  customer?: Party;
  store?: Store;
}

export interface SyncEvent {
  id: number;
  store_id: number;
  device_id?: number;
  entity_type: string;
  entity_id: string;
  action: string;
  client_version: number;
  server_version: number;
  client_data?: Record<string, unknown>;
  server_data?: Record<string, unknown>;
  status: "pending" | "resolved" | "conflict" | "failed";
  conflict_reason?: string;
  resolution?: "keep_cloud" | "keep_local" | "merge";
  resolved_by?: number;
  error_message?: string;
  created_at: string;
  store?: { id: number; name: string; code: string };
  device?: { id: number; device_name: string };
}

export interface AuditLog {
  id: number;
  store_id?: number;
  user_id?: number;
  impersonator_id?: number;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
  user?: { id: number; name: string; email: string; role: string };
  impersonator?: { id: number; name: string; email: string };
  store?: { id: number; name: string; code: string };
}

export interface NotificationItem {
  id: number;
  store_id?: number;
  title: string;
  message: string;
  type: "stock_low" | "expiry" | "store_offline" | "sync_failure" | "license_expiry";
  is_read: boolean;
  data?: Record<string, unknown>;
  created_at: string;
}
