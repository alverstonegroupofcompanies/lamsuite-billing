import type { BusinessRuleErrorPayload, RestrictedDrugLine } from "../errors/businessRuleError";

/**
 * GAP-02 / PHR-004, PHR-006 — what the till does when a restricted drug is on
 * the bill and no pharmacist has vouched for it.
 *
 * The server is the authority: it reads the schedule list, the registration and
 * the credential, and it refuses before anything is written. The till's job is
 * the two things only it can do — show the cashier which lines are held, and
 * carry a pharmacist's PIN to the server exactly once. A credential that outlives
 * the save is a liability, so nothing the till keeps on disk is allowed to hold
 * one, and an offline bill queues who was named and lets the server re-check the
 * credential when the document lands.
 */

/** What the refusal tells the till to open. */
export const PHARMACIST_CONFIRMATION_ACTION = "pos.pharmacist_confirmation";

export const PHARMACIST_CONFIRMATION_REQUIRED = "PHARMACIST_CONFIRMATION_REQUIRED";

export const PHARMACIST_CONFIRMATION_INVALID = "PHARMACIST_CONFIRMATION_INVALID";

export interface PharmacistCredential {
  pharmacistId: string;
  pin: string;
}

export function isPharmacistRefusal(code: unknown): code is string {
  return code === PHARMACIST_CONFIRMATION_REQUIRED || code === PHARMACIST_CONFIRMATION_INVALID;
}

export class PharmacistConfirmationRequiredError extends Error {
  readonly code: string;
  readonly field: string | null;
  readonly fix: string | null;
  readonly restrictedItems: RestrictedDrugLine[];
  readonly externalId: string;

  constructor(payload: BusinessRuleErrorPayload, externalId: string) {
    super(payload.message);
    this.name = "PharmacistConfirmationRequiredError";
    this.code = payload.code;
    this.field = payload.field;
    this.fix = payload.fix;
    this.restrictedItems = payload.restricted_items || [];
    this.externalId = externalId;
  }
}

/**
 * The two fields the gate reads. A half credential is worse than none: it names
 * a pharmacist the server then refuses for an empty PIN, so an incomplete entry
 * sends nothing at all and the prompt stays on screen.
 */
export function pharmacistFields(
  credential?: PharmacistCredential | null
): { pharmacist_id?: string; pharmacist_pin?: string } {
  const pharmacistId = (credential?.pharmacistId || "").trim();
  const pin = (credential?.pin || "").trim();

  if (pharmacistId === "" || pin === "") return {};

  return { pharmacist_id: pharmacistId, pharmacist_pin: pin };
}

/**
 * The copy that goes on disk. Who was named is evidence the store keeps; the
 * PIN is evidence only for the request it was typed into.
 */
export function withoutPharmacistPin<T extends { pharmacist_pin?: unknown }>(payload: T): T {
  const { pharmacist_pin: _pin, ...rest } = payload;
  return rest as T;
}
