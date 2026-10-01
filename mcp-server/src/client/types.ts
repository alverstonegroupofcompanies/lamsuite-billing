export interface PaginatedResponse<T> {
  data: T[];
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
  next_cursor?: string | null;
}

export interface StoreProfile {
  id: number;
  name: string;
  code: string;
  phone?: string;
  email?: string;
  address?: string;
  state_code: string;
  gstin?: string;
  drug_license_numbers?: string[];
  fssai_no?: string;
  tax_mode: "inclusive" | "exclusive";
  invoice_prefix: string;
  enabled_menu_items?: string[];
}

export interface ProductBatchData {
  id: string;
  product_id: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  stock_qty: number;
  mrp?: number;
  purchase_rate?: number;
  selling_rate?: number;
  rack_location?: string;
  shelf_location?: string;
}

export interface ProductData {
  id: string;
  name: string;
  print_name?: string;
  barcode: string;
  secondary_barcodes?: string[];
  hsn_sac_code?: string;
  category_id?: string;
  brand_id?: string;
  unit_id?: string;
  mrp: number;
  sel_rate: number;
  ptr?: number;
  pts?: number;
  gst_percent: number;
  units_per_pack: number;
  generic_name?: string;
  strength?: string;
  rack_location?: string;
  shelf_location?: string;
  reorder_level?: number;
  current_stock?: number;
  is_active: boolean;
  batches?: ProductBatchData[];
  external_id?: string;
}

export interface InvoiceLineItem {
  id?: string;
  product_id: string;
  product_name?: string;
  batch_no?: string;
  expiry_date?: string;
  qty: number;
  loose_qty?: number;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  total_amount: number;
}

export interface InvoiceData {
  id: string | number;
  external_id?: string;
  module_key?: string;
  invoice_number: string;
  invoice_date: string;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string;
  customer_gstin?: string | null;
  place_of_supply?: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total?: number;
  sgst_total?: number;
  igst_total?: number;
  round_off: number;
  grand_total: number;
  paid_amount?: number;
  payment_mode: string;
  status: "issued" | "cancelled" | "refunded";
  cancellation_reason?: string;
  patient_name?: string | null;
  doctor_name?: string | null;
  doctor_reg_no?: string | null;
  items?: InvoiceLineItem[];
  created_at?: string;
}

export interface CustomerData {
  id: string;
  name: string;
  phone: string;
  phones?: string[];
  gstin?: string;
  address?: string;
  outstanding_balance?: number;
  credit_limit?: number;
  is_active: boolean;
}

export interface SupplierData {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
  credit_period_days?: number;
  outstanding_balance?: number;
  is_active: boolean;
}

export interface PurchaseLineItem {
  product_id: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  qty: number;
  purchase_rate: number;
  mrp: number;
  gst_percent: number;
  total_amount?: number;
}

export interface PurchaseData {
  id: string | number;
  external_id?: string;
  purchase_number: string;
  purchase_date: string;
  supplier_id: string;
  supplier_name?: string;
  grand_total: number;
  items?: PurchaseLineItem[];
  payment_terms?: string;
  status?: string;
}

export interface SalesSummaryData {
  date_range: { start_date: string; end_date: string };
  total_invoices_count: number;
  gross_sales: number;
  total_returns: number;
  net_sales: number;
  by_tender: Record<string, number>;
  total_taxable: number;
  total_tax: number;
  total_round_off: number;
}
