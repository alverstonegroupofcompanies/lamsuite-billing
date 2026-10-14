export type FieldType = "string" | "number" | "currency" | "date" | "boolean" | "select";

export type EntityCategory = "masters" | "transactions" | "stock" | "finance" | "clinical" | "reports";

export interface FieldSelectOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: any;
  example?: string | number | boolean;
  description?: string;
  options?: FieldSelectOption[];
  aliases?: string[]; // Alternative header names from Marg, Busy, Tally, etc.
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternErrorMessage?: string;
}

export interface DuplicateKeyDef {
  id: string;
  label: string;
  fields: string[];
  exactMatch?: boolean;
}

export interface ForeignKeyDef {
  field: string;
  targetEntityId: string;
  lookupField: string; // e.g. "name" or "code"
  autoCreateSupported: boolean;
  createPayload?: (value: string) => Record<string, any>;
}

export type RowAction = "create" | "update" | "merge" | "skip" | "error";

export interface RowValidationError {
  rowNumber: number;
  field?: string;
  value?: any;
  message: string;
  severity: "error" | "warning";
  code?: string;
}

export interface ValidationContext {
  existingRecords: Record<string, any>[];
  foreignKeysCache: Record<string, Record<string, any>[]>;
  financialYearLocked?: boolean;
  gstPeriodLocked?: boolean;
}

export interface PostImportContext {
  userId: string;
  userName: string;
  storeId: string;
  counterId: string;
  batchId: string;
  actionPolicy: "create_missing_masters" | "skip_duplicates" | "update_existing" | "merge_existing";
}

export interface EntityDefinition<T = any> {
  id: string;
  label: string;
  singularLabel: string;
  category: EntityCategory;
  description: string;
  targetTable: string;
  primaryKey: string;
  requiredPermission: string;
  fields: Record<string, FieldDefinition>;
  duplicateKeys: DuplicateKeyDef[];
  foreignKeys?: ForeignKeyDef[];
  sampleRows: Record<string, any>[];
  supportsRoundTrip: boolean;
  rowActionSupport?: {
    allowCreateMissingFk?: boolean;
    allowUpdate?: boolean;
    allowMerge?: boolean;
    allowSkip?: boolean;
  };
  validateRow?: (row: T, index: number, context: ValidationContext) => RowValidationError[];
  transformRow?: (row: Record<string, any>, context: any) => T;
  postImportHook?: (importedRows: T[], context: PostImportContext) => Promise<void>;
  exportQuery?: (filters?: Record<string, any>) => Promise<T[]>;
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number; // 0 to 1
  isAutoMatched: boolean;
}

export interface ImportPreviewRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: RowValidationError[];
  action: RowAction;
  duplicateMatch?: {
    key: string;
    existingId: string;
    existingSummary: string;
  };
  missingForeignKeys?: Array<{
    field: string;
    targetEntityId: string;
    value: string;
  }>;
}

export interface ImportDryRunSummary {
  totalRows: number;
  validRowsCount: number;
  errorRowsCount: number;
  warningRowsCount: number;
  toCreateCount: number;
  toUpdateCount: number;
  toSkipCount: number;
  toMergeCount: number;
  missingMasters: Array<{
    entityId: string;
    field: string;
    values: string[];
  }>;
}

export interface ImportExecutionResult {
  success: boolean;
  batchId: string;
  entityId: string;
  totalProcessed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  mergedCount: number;
  failedCount: number;
  errors: RowValidationError[];
  undoToken?: string;
  executionTimeMs: number;
}
