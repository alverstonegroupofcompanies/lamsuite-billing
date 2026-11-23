import { sqliteStorage } from "../db/sqliteStorage";
import { chargeHeadsStore, type ChargeHeadMaster } from "../masters/chargeHeadsStore";
import type {
  ChargeItcEligibility,
  ChargeSpreadMethod,
  ChargeTreatment,
  TaxEngineCalculatedCharge,
  TaxEngineChargeInput,
  TaxEngineDocumentTotals,
  TaxEngineLineInput,
} from "../tax-engine/taxEngine";
import type { PurchaseLineItemInput } from "./purchaseService";

/**
 * CR-C on the till. A charge line entered on a supplier bill is stored exactly as the shared
 * tax engine priced it, so the offline screen, the printed bill and the server row are the same
 * paisa (SYNC-007): the charge keeps its own row, every goods line keeps its share of it, the
 * batch keeps the landed cost while the supplier's rate stays visible, and an expense-treated
 * charge lands in the expense register.
 *
 * Nothing here decides a number. Resolution turns a head code into the head's presets and the
 * posting writes what the engine returned.
 */

export type ChargeSource = "manual" | "legacy_freight" | "return_reversal";

export interface PurchaseChargeInput {
  external_id?: string;
  /** Head code or head name — resolved against this store's own heads (rule R12). */
  head_code: string;
  head_name?: string;
  note?: string | null;
  amount: number;
  gst_percent: number;
  cess_percent?: number;
  treatment?: ChargeTreatment;
  spread_method?: ChargeSpreadMethod;
  itc_eligibility?: ChargeItcEligibility;
  is_rcm?: boolean;
  paid_separately?: boolean;
  paid_to_label?: string | null;
  place_of_supply?: string | null;
  sac_code?: string | null;
  /** Where the line came from; a grid row keyed from a legacy Freight field says so. */
  source?: ChargeSource;
  seq?: number;
}

export interface ResolvedCharge extends TaxEngineChargeInput {
  charge_id: string;
  external_id: string;
  seq: number;
  head_code: string;
  head_name: string;
  note: string | null;
  place_of_supply: string | null;
  source: ChargeSource;
}

const PAISA = 0.005;

/**
 * Turn the operator's charge lines into engine inputs, filled from this store's own heads.
 * A head the store does not have is refused rather than invented, because a charge posted
 * against a foreign head could never be reassigned or totalled in that store's registers.
 */
export async function resolveCharges(
  charges: PurchaseChargeInput[],
  documentPlaceOfSupply?: string | null
): Promise<ResolvedCharge[]> {
  return resolveChargesWith(await chargeHeadsStore.getAllHeads(), charges, documentPlaceOfSupply);
}

/**
 * The same resolution against heads the caller already holds. The purchase screen prices its
 * totals from this on every keystroke, so it cannot wait on the master each time — and it must
 * not keep a second copy of these rules either, or the screen and the posted bill disagree.
 */
export function resolveChargesWith(
  heads: ChargeHeadMaster[],
  charges: PurchaseChargeInput[],
  documentPlaceOfSupply?: string | null
): ResolvedCharge[] {
  const resolved: ResolvedCharge[] = [];

  for (const raw of charges || []) {
    if (!raw || typeof raw !== "object") continue;

    const amount = Number(raw.amount) || 0;
    if (Math.abs(amount) < PAISA) continue;

    const head = findHead(heads, raw.head_code);
    if (!head) {
      throw new Error(
        `Charge head "${String(raw.head_code || "").trim()}" does not exist in this store (rule R12).`
      );
    }
    if (!head.is_active) {
      throw new Error(`Charge head "${head.name}" is not active in this store.`);
    }

    const allowed = head.allowed_sign;
    if (amount < 0 && allowed === "positive") {
      throw new Error(`A negative amount is not allowed on the charge head "${head.name}".`);
    }
    if (amount > 0 && allowed === "negative") {
      throw new Error(`Only a credit (negative) amount is allowed on "${head.name}".`);
    }

    // The engine taxes a document, not a line: a charge claiming its own place of supply
    // would be silently ignored, so it is refused instead — same rule the server applies.
    if (
      raw.place_of_supply &&
      documentPlaceOfSupply &&
      String(raw.place_of_supply) !== String(documentPlaceOfSupply)
    ) {
      throw new Error(
        "A charge is taxed by the place of supply of its supplier bill, not its own."
      );
    }

    const seq = resolved.length + 1;
    const externalId = raw.external_id?.trim() || `chg-${head.code}-${amount}`;

    resolved.push({
      charge_id: externalId,
      external_id: externalId,
      seq,
      head_code: head.code,
      head_name: head.name,
      note: raw.note ?? null,
      amount,
      gst_percent: Number(raw.gst_percent) || 0,
      cess_percent: Number(raw.cess_percent) || 0,
      treatment: raw.treatment ?? head.default_treatment,
      spread_method: raw.spread_method ?? head.default_spread_method,
      itc_eligibility: raw.itc_eligibility ?? head.default_itc_eligibility,
      is_rcm: Boolean(raw.is_rcm),
      paid_separately: Boolean(raw.paid_separately),
      paid_to_label: raw.paid_to_label ?? null,
      sac_code: raw.sac_code || head.sac_code || undefined,
      place_of_supply: raw.place_of_supply ?? documentPlaceOfSupply ?? null,
      source: raw.source ?? "manual",
    });
  }

  return resolved;
}

/**
 * PUR-017: a bill keyed before CR-C carried one freight scalar. It enters the same path as a
 * Freight charge at 0% GST, so nothing is re-taxed and no historic total is restated.
 */
export async function legacyFreightCharge(
  freightCharges: number,
  documentPlaceOfSupply?: string | null
): Promise<ResolvedCharge[]> {
  if (Math.abs(Number(freightCharges) || 0) < PAISA) return [];

  return resolveCharges(
    [
      {
        head_code: "FREIGHT",
        amount: Number(freightCharges),
        gst_percent: 0,
        treatment: "add_to_cost",
        spread_method: "value",
        itc_eligibility: "eligible",
        note: "Legacy freight carried over from a pre-charges bill",
      },
    ],
    documentPlaceOfSupply
  ).then((list) => list.map((c) => ({ ...c, source: "legacy_freight" as const })));
}

function findHead(
  heads: Awaited<ReturnType<typeof chargeHeadsStore.getAllHeads>>,
  needle: string
) {
  const query = String(needle || "").trim().toLowerCase();
  if (!query) return null;
  return (
    heads.find((h) => h.code.toLowerCase() === query) ||
    heads.find((h) => h.name.toLowerCase() === query) ||
    null
  );
}

/**
 * Purchase lines in the shape the shared engine expects. One builder for the totals bar, the
 * posted document and the push payload, so the screen can never show a different number than
 * the bill it saves.
 */
export function engineLines(
  lines: PurchaseLineItemInput[],
  opts: { taxInclusive: boolean; rateBasis?: "ptr" | "mrp" | "pts" | "ptss" | "sel_rate" }
): TaxEngineLineInput[] {
  return (lines || []).map((line, idx) => {
    const discountType = line.discount_type;
    return {
      line_id: String(idx),
      product_id: line.product_id,
      product_name: line.product_name,
      hsn_code: line.hsn_code,
      qty: Math.max(0, line.pack_qty ?? line.qty ?? 0),
      loose_qty: Math.max(0, line.loose_qty || 0),
      free_qty: Math.max(0, line.free_qty || 0),
      free_loose_qty: Math.max(0, line.free_loose_qty || 0),
      units_per_pack: Math.max(1, line.units_per_pack || 1),
      unit_price: line.purchase_rate,
      mrp: line.mrp,
      rate_basis: opts.rateBasis || "ptr",
      discount_percent: discountType === "amount" ? 0 : line.discount_percent || 0,
      discount_amount: discountType === "percent" ? 0 : line.discount_amount || 0,
      gst_percent: line.gst_percent,
      cess_percent: line.cess_percent || 0,
      // CR-C D1: weight is entered per line at purchase so a weight-spread charge needs no
      // master data; absent weight makes the engine fall back to value for the whole charge.
      gross_weight_kg:
        line.gross_weight_kg === undefined || line.gross_weight_kg === null
          ? null
          : Number(line.gross_weight_kg),
      is_tax_inclusive: opts.taxInclusive,
    };
  });
}

/** The charge lines exactly as the server's sync ingest expects them. */
export function chargePayload(charges: ResolvedCharge[]): Record<string, unknown>[] {
  return charges.map((c) => ({
    external_id: c.external_id,
    seq: c.seq,
    head_code: c.head_code,
    head_name: c.head_name,
    note: c.note,
    amount: c.amount,
    gst_percent: c.gst_percent,
    cess_percent: c.cess_percent || 0,
    treatment: c.treatment,
    spread_method: c.spread_method,
    itc_eligibility: c.itc_eligibility,
    is_rcm: c.is_rcm ? 1 : 0,
    paid_separately: c.paid_separately ? 1 : 0,
    paid_to_label: c.paid_to_label,
    place_of_supply: c.place_of_supply,
    sac_code: c.sac_code,
    source: c.source,
  }));
}

export interface ChargePostingResult {
  charges: Record<string, unknown>[];
  expenseIds: string[];
}

/**
 * Take a document's charge postings out, with the register rows they generated. A cancelled
 * debit note and a bill whose charges were all removed both end here, so nothing that was
 * given back keeps posting money a second time.
 */
export async function removePostedCharges(purchaseId: string): Promise<void> {
  const rows = (await sqliteStorage.findAll<Record<string, any>>("purchase_charges")).filter(
    (row) => String(row.purchase_id) === purchaseId
  );

  for (const row of rows) {
    if (row.expense_id) await sqliteStorage.deleteRecord("expenses", String(row.expense_id));
    await sqliteStorage.deleteRecord("purchase_charges", String(row.id));
  }

  const allocations = (
    await sqliteStorage.findAll<Record<string, any>>("purchase_charge_allocations")
  ).filter((a) => String(a.purchase_charge_id) && rows.some((r) => String(r.id) === String(a.purchase_charge_id)));

  for (const allocation of allocations) {
    await sqliteStorage.deleteRecord("purchase_charge_allocations", String(allocation.id));
  }
}

/**
 * Write the engine's charge numbers onto the bill: rows, the paisa-exact spread per goods line,
 * the landed cost on the batch, and an expense register row where the store chose to expense it.
 *
 * Rows are keyed by the till's own external id, so a re-post of the same bill updates the same
 * row instead of duplicating money — and the charge rows a re-post did not send are deleted,
 * because a removed charge must leave no trace behind.
 */
export async function postCharges(args: {
  purchaseId: string;
  invoiceNumber?: string;
  charges: ResolvedCharge[];
  result: TaxEngineDocumentTotals;
  purchaseLines: PurchaseLineItemInput[];
  itemIdsByLine: Record<string, string>;
  createdBy?: string;
}): Promise<ChargePostingResult> {
  const storeId = sqliteStorage.getActiveStoreId() || "";
  const now = Date.now();
  const linesById = new Map(args.result.lines.map((l) => [String(l.line_id), l]));

  const incoming = new Set(args.charges.map((c) => c.external_id));
  const weights = (args.purchaseLines || []).map((l) => Number(l.gross_weight_kg) || 0);

  const existing = (await sqliteStorage.findAll<Record<string, any>>("purchase_charges")).filter(
    (row) => String(row.purchase_id) === args.purchaseId
  );
  for (const row of existing) {
    if (incoming.has(String(row.external_id))) continue;
    await sqliteStorage.deleteRecord("purchase_charges", String(row.id));
    if (row.expense_id) await sqliteStorage.deleteRecord("expenses", String(row.expense_id));
  }

  const out: Record<string, unknown>[] = [];
  const expenseIds: string[] = [];

  for (const charge of args.charges) {
    const calculated = args.result.charges[charge.seq - 1] as
      | TaxEngineCalculatedCharge
      | undefined;
    if (!calculated) continue;

    const chargeId = `chg_${args.purchaseId}_${charge.external_id}`;
    const allocated = round2(
      (calculated.allocations || []).reduce((sum, a) => sum + a.allocated_amount, 0)
    );

    const basis = spreadBasis(calculated.spread_basis_used, args.result.lines, weights);
    const totalBasis = basis.reduce((sum, b) => sum + Math.abs(b), 0);

    const allocationRows: Record<string, unknown>[] = [];
    for (const allocation of calculated.allocations || []) {
      const lineId = String(allocation.line_id);
      const itemId = args.itemIdsByLine[lineId];
      if (!itemId) continue;

      const basisAmount = basis[Number(lineId)] ?? 0;
      allocationRows.push({
        id: `${chargeId}|${lineId}`,
        external_id: `${chargeId}|${lineId}`,
        store_id: storeId,
        purchase_charge_id: chargeId,
        purchase_item_id: itemId,
        batch_id: null,
        basis_amount: basisAmount,
        basis_share: totalBasis > 0 ? basisAmount / totalBasis : 0,
        allocated_amount: allocation.allocated_amount,
        is_remainder_paisa: allocation.is_remainder_paisa ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    }

    let expenseId: string | null = null;
    // Written here, never queued on its own: the server books the same register row when it
    // ingests this bill's charges, so pushing an expense entity too would double the book.
    if (calculated.treatment === "expense") {
      const amount = round2(calculated.expense_posting);
      if (Math.abs(amount) >= PAISA) {
        expenseId = `exp_pc_${args.purchaseId}_${charge.seq}`;
        await sqliteStorage.insertRecord("expenses", expenseId, {
          id: expenseId,
          expense_number: `EXP-PC-${args.purchaseId}-${charge.seq}`,
          expense_head: charge.head_name,
          amount,
          payment_mode: calculated.paid_separately ? "Paid Separately" : "On Account",
          reference_no: args.invoiceNumber || "",
          notes: `Booked from charge ${charge.head_name} on bill ${args.invoiceNumber || args.purchaseId}${
            charge.note ? ` — ${charge.note}` : ""
          }`,
          expense_date: nowDate(),
          created_by: args.createdBy,
          created_at: now,
          purchase_id: args.purchaseId,
          purchase_charge_id: chargeId,
          gst_percent: calculated.gst_rate,
          cgst_amount: calculated.cgst_amount,
          sgst_amount: calculated.sgst_amount,
          igst_amount: calculated.igst_amount,
          itc_eligibility: calculated.itc_eligibility,
          paid_separately: calculated.paid_separately ? 1 : 0,
        });
        expenseIds.push(expenseId);
      }
    }

    const row = {
      id: chargeId,
      external_id: charge.external_id,
      store_id: storeId,
      purchase_id: args.purchaseId,
      seq: charge.seq,
      head_code: charge.head_code,
      head_name: charge.head_name,
      note: charge.note,
      treatment: calculated.treatment,
      spread_method: calculated.spread_method,
      spread_basis_used: calculated.spread_basis_used,
      itc_eligibility: calculated.itc_eligibility,
      is_rcm: calculated.is_rcm ? 1 : 0,
      paid_separately: calculated.paid_separately ? 1 : 0,
      // CR-C-11: stored with the line, never re-derived from today's policy, so turning the
      // switch on cannot restate a bill that has already been printed (PUR-016).
      in_payable: calculated.in_payable ? 1 : 0,
      paid_to_label: calculated.paid_to_label,
      place_of_supply: charge.place_of_supply,
      sac_code: calculated.sac_code,
      amount: calculated.amount,
      gst_percent: calculated.gst_rate,
      taxable_amount: calculated.taxable_amount,
      cgst_amount: calculated.cgst_amount,
      sgst_amount: calculated.sgst_amount,
      igst_amount: calculated.igst_amount,
      cess_amount: calculated.cess_amount,
      total_amount: calculated.total_amount,
      allocated_amount: allocated,
      source: charge.source,
      expense_id: expenseId,
      reversed_amount: 0,
      created_by: args.createdBy,
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("purchase_charges", chargeId, row);

    const existingAllocations = (
      await sqliteStorage.findAll<Record<string, any>>("purchase_charge_allocations")
    ).filter((a) => String(a.purchase_charge_id) === chargeId);
    const keep = new Set(allocationRows.map((a) => String(a.id)));
    for (const stale of existingAllocations) {
      if (!keep.has(String(stale.id))) {
        await sqliteStorage.deleteRecord("purchase_charge_allocations", String(stale.id));
      }
    }
    for (const allocation of allocationRows) {
      await sqliteStorage.insertRecord("purchase_charge_allocations", String(allocation.id), allocation);
    }

    out.push({ ...row, allocations: allocationRows });
  }

  await writeLandedCost(args.purchaseId, args.result, args.itemIdsByLine);

  return { charges: out, expenseIds };
}

/**
 * PUR-002/PUR-011: the goods line carries the charge share the engine computed and the batch
 * carries the landed rate, while the supplier's own purchase rate is never overwritten —
 * an invoice dispute has to stay readable.
 */
async function writeLandedCost(
  purchaseId: string,
  result: TaxEngineDocumentTotals,
  itemIdsByLine: Record<string, string>
): Promise<void> {
  for (const line of result.lines) {
    const itemId = itemIdsByLine[String(line.line_id)];
    if (!itemId) continue;

    const item = await sqliteStorage.findById<Record<string, any>>("purchase_items", itemId);
    if (!item) continue;

    const allocation = round2(line.charge_allocation || 0);
    await sqliteStorage.updateRecord("purchase_items", itemId, {
      charge_allocation: allocation,
      landed_unit_cost: line.landed_unit_cost,
      effective_unit_cost: line.effective_unit_cost ?? allocation ? line.landed_unit_cost : item.effective_unit_cost,
    });

    if (!item.batch_id) continue;
    const units = Number(line.total_units) || 0;
    if (units <= 0) continue;

    const batch = await sqliteStorage.findById<Record<string, any>>(
      "product_batches",
      String(item.batch_id)
    );
    if (!batch) continue;

    await sqliteStorage.updateRecord("product_batches", String(item.batch_id), {
      landed_cost_rate: round4((Number(batch.purchase_rate) || 0) + allocation / units),
    });
  }

  void purchaseId;
}

function spreadBasis(basisUsed: string, lines: TaxEngineDocumentTotals["lines"], weights: number[]): number[] {
  return lines.map((line, idx) =>
    basisUsed === "quantity"
      ? Number(line.total_units) || 0
      : basisUsed === "weight"
        ? weights[idx] || 0
        : Number(line.taxable_amount) || 0
  );
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function nowDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
