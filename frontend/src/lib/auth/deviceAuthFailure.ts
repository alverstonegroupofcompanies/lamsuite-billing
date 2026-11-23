/**
 * CNT-011 / SYNC-02 — one place decides that a 401/403 came from the device
 * credential rather than from the network.
 *
 * The server answers every device-authentication refusal with the same shape
 * (success:false, error:"DEVICE_AUTH_FAILED"), whether the token is unknown,
 * the counter was retired or the store was suspended. Every caller that talks
 * to a device-authenticated route routes those answers here, so a revoked till
 * is locked once, and a 500 is never mistaken for one.
 */

export interface DeviceAuthFailureBody {
  success?: boolean;
  error?: string;
  message?: string;
  status?: string;
  action?: string;
}

export class DeviceAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DeviceAuthError";
    this.status = status;
    this.code = code;
  }
}

export function isDeviceAuthFailure(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403) return false;
  const answer = (body ?? {}) as DeviceAuthFailureBody;
  // A 401 on a device route is always the credential. A 403 must name the
  // device failure so a store-level refusal is not mistaken for revocation.
  return answer.error === "DEVICE_AUTH_FAILED" || status === 401;
}

export function deviceAuthErrorFrom(status: number, body: unknown): DeviceAuthError {
  const answer = (body ?? {}) as DeviceAuthFailureBody;
  return new DeviceAuthError(
    status,
    answer.error || "DEVICE_AUTH_FAILED",
    answer.message || `Device authentication failed (HTTP ${status}).`
  );
}

/**
 * Asks the one authority that already tells revocation, a suspended store and
 * a paused counter apart, rather than duplicating that judgement at the call
 * site. Returns whether the workstation was reset to the claim screen.
 */
export async function handleDeviceAuthFailure(): Promise<{ locked: boolean; reason?: string }> {
  const { storeDeviceService } = await import("./storeDeviceService");
  const result = await storeDeviceService
    .validateDeviceSession()
    .catch(() => ({ valid: false, locked: false } as { valid: boolean; locked?: boolean; reason?: string }));

  return { locked: Boolean(result?.locked), reason: result?.reason };
}
