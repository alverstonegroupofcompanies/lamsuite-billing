import React from "react";

export type ReportCategory =
  | "sales"
  | "purchase"
  | "inventory"
  | "gst"
  | "customer"
  | "supplier"
  | "profit"
  | "pharmacy"
  | "quick";

export interface ReportCategoryMeta {
  id: ReportCategory;
  label: string;
  description: string;
  iconName: string;
}

export type ColumnFormat =
  | "currency"
  | "number"
  | "date"
  | "datetime"
  | "percentage"
  | "text"
  | "badge";

export type TotalCalculationType = "sum" | "avg" | "count" | "none";

export interface ReportColumn<TRow = any> {
  id: string;
  header: string;
  accessor: (row: TRow) => any;
  align?: "left" | "center" | "right";
  width?: number; // width in pixels
  format?: ColumnFormat;
  badgeStyle?: (val: any, row: TRow) => "success" | "warning" | "danger" | "info" | "neutral";
  isDefaultVisible: boolean;
  canHide?: boolean; // false if column is mandatory
  canSort?: boolean;
  totalType?: TotalCalculationType;
  renderCell?: (row: TRow, value: any) => React.ReactNode;
}

export type FilterFieldType =
  | "date-range"
  | "date"
  | "select"
  | "multi-select"
  | "text"
  | "number"
  | "boolean";

export interface FilterSelectOption {
  label: string;
  value: string | number;
}

export interface ReportFilterDef {
  id: string;
  label: string;
  type: FilterFieldType;
  placeholder?: string;
  options?: FilterSelectOption[];
  defaultValue: any;
  required?: boolean;
  quickPresets?: Array<{ label: string; value: any }>;
}

export interface ReportSortState {
  column: string;
  direction: "asc" | "desc";
}

export interface ReportPaginationState {
  page: number; // 1-indexed
  pageSize: number;
}

export interface ReportQueryParams<TFilter = Record<string, any>> {
  filters: TFilter;
  pagination?: ReportPaginationState;
  sort?: ReportSortState;
  searchQuery?: string;
}

export interface ReportQueryResult<TRow = any, TSummary = any> {
  rows: TRow[];
  totalCount: number;
  summary?: TSummary;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

export interface PrintableDocumentHeader {
  id: string;
  label: string;
  align?: "left" | "center" | "right";
  format?: ColumnFormat;
  width?: number;
}

export interface PrintableDocumentData {
  title: string;
  subtitle?: string;
  storeDetails: {
    storeName: string;
    address: string;
    phone: string;
    gstin?: string;
    dlNo?: string;
  };
  filterSummary: Array<{ label: string; value: string }>;
  generatedAt: string;
  headers: PrintableDocumentHeader[];
  rows: Array<Record<string, any>>;
  totals?: Record<string, any>;
}

export interface ReportPrintFormattingOptions {
  fontSize?: "small" | "normal" | "large";
  margins?: "normal" | "compact" | "none";
  showHeader?: boolean;
  showFooter?: boolean;
  showFilterSummary?: boolean;
  operatorName?: string;
  zoomScale?: number;
  printerColumns?: number;
  autoCenter?: boolean;
  leftMarginSpaces?: number;
}

export interface ReportModule<TFilter = any, TRow = any, TSummary = any> {
  id: string;
  title: string;
  description: string;
  category: ReportCategory;
  permission: string; // RBAC permission code e.g. "reports:view", "reports.sales.view"
  menuVisibilityKey: string; // Store setting key e.g. "reports", "bills"
  keywords?: string[]; // for fuzzy search
  
  defaultSort?: ReportSortState;
  supportedPrintLayouts: Array<"a4" | "thermal" | "dot-matrix">;
  exportFormats: Array<"csv" | "excel" | "pdf">;

  // Filter definitions
  filters: ReportFilterDef[];

  // Column definitions
  columns: ReportColumn<TRow>[];

  // Execution query
  runQuery: (params: ReportQueryParams<TFilter>) => Promise<ReportQueryResult<TRow, TSummary>>;

  // Custom print payload formatting (optional)
  buildPrintDocument?: (
    result: ReportQueryResult<TRow, TSummary>,
    filters: TFilter,
    storeInfo: any
  ) => PrintableDocumentData;
}
