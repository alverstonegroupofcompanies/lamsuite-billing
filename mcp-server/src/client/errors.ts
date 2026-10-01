export class McpToolError extends Error {
  public code: string;
  public statusCode?: number;
  public details?: any;

  constructor(message: string, code: string = "INTERNAL_ERROR", statusCode?: number, details?: any) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class PermissionDeniedError extends McpToolError {
  constructor(message: string, details?: any) {
    super(message, "PERMISSION_DENIED", 403, details);
    this.name = "PermissionDeniedError";
  }
}

export class NotFoundError extends McpToolError {
  constructor(message: string, details?: any) {
    super(message, "NOT_FOUND", 404, details);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends McpToolError {
  constructor(message: string, details?: any) {
    super(message, "VALIDATION_FAILED", 422, details);
    this.name = "ValidationError";
  }
}

export class StoreOfflineError extends McpToolError {
  constructor(message: string, details?: any) {
    super(message, "STORE_OFFLINE", 503, details);
    this.name = "StoreOfflineError";
  }
}

export class TimeoutError extends McpToolError {
  constructor(message: string, details?: any) {
    super(message, "TIMEOUT", 408, details);
    this.name = "TimeoutError";
  }
}

export class DestructiveConfirmationError extends McpToolError {
  constructor(action: string) {
    super(
      `Destructive operation safety block: You must explicitly set 'confirm: true' and provide a non-empty 'reason' parameter to proceed with ${action}.`,
      "CONFIRMATION_REQUIRED",
      400
    );
    this.name = "DestructiveConfirmationError";
  }
}
