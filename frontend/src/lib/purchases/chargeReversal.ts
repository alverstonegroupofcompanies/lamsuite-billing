import { sqliteStorage } from "../db/sqliteStorage";
import { storedInPayable } from "../reports/purchaseChargeRegister";
import { companySettingsService } from "../settings/companySettingsService";
import type { ResolvedCharge } from "./chargePosting";

/**
 * CR-C Task 4.12 on the till — the mirror of `PurchaseChargeReversalService`.
 *
 * Goods going back to the supplier take their share of the bill's charges with them, and the
 * figure is derived per goods line rather than from the note's own percentage (PUR-003). It is
 * always re-derived from the returns the till holds, never added to, so re-opening a note, a
 * second part-return or a cancellation cannot reverse the same paisa twice (PUR-015, SYNC-002).
 *
 * The same math runs on the server when the note is ingested; keeping both here in one place is
 * what lets the offline screen print the debit note the cloud will agree with (SYNC-007).
 */

export type ChargeReversalPolicy = "proportional" | "sunk";

const PAISA = 0.005;

type Row = Record<string, any>;

/** What the return screen knows about one line of goods going back. */
type ReturnLine = { product_id: string; batch_no?: string | null; return_qty: number };

/**
 * PUR-016 / CFG-003: the store's own rule for what a return does to charges. A sunk store keeps
 * the freight it already paid as a cost of the goods it sold, so nothing reverses. Read when the
 * return is posted, never stored on the bill, so a policy change alters future notes only — the
 * same rule the server applies.
 */
export async function reversalPolicy(): Promise<ChargeReversalPolicy> {
  const settings = (await companySettingsService.loadSettings()) as unknown as Row;
  const configured =
    settings?.purchase_charges?.reverse_on_return ??
    settings?.billing?.purchase_charges?.reverse_on_return;

  return configured === "sunk" ? "sunk" : "proportional";
}

/** The money a charge put on stock or on the expense register — what a return gives back. */
export function reversibleAmount(charge: Row): number {
  const allocated = round2(Number(charge.allocated_amount) || 0);
  if (Math.abs(allocated) >= PAISA) return allocated;

  if (charge.treatment !== "expense") return 0;

  const nonCreditable =
    charge.itc_eligibility === "eligible"
      ? 0
      : round2(
          (Number(charge.cgst_amount) || 0) +
            (Number(charge.sgst_amount) || 0) +
            (Number(charge.igst_amount) || 0) +
            (Number(charge.cess_amount) || 0)
        );

  return round2((Number(charge.taxable_amount) || 0) + nonCreditable);
}

export function isFullyReversed(charge: Row): boolean {
  return Math.abs(reversibleAmount(charge) - round2(Number(charge.reversed_amount) || 0)) < PAISA;
}

/**
 * The inward bill a debit note returns against, by the same ladder the server uses: the id the
 * return screen held, then any number the note carries, then the number left in its notes.
 */
export async function findOriginalBill(refs: {
  original_purchase_id?: string | null;
  original_purchase_number?: string | null;
  supplier_invoice_no?: string | null;
  notes?: string | null;
}): Promise<Row | null> {
  const documents = await sqliteStorage.findAll<Row>("purchase_documents");
  const inward = documents.filter(
    (d) => d.module_key !== "purchase_return" && d.module_key !== "debit_note"
  );

  const direct = String(refs.original_purchase_id ?? "").trim();
  if (direct) {
    const found = inward.find(
      (d) => String(d.id) === direct || String(d.external_id ?? "") === direct
    );
    if (found) return found;
  }

  const numbers = [refs.original_purchase_number, refs.supplier_invoice_no]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "");

  for (const number of numbers) {
    const found = inward.find(
      (d) =>
        String(d.supplier_invoice_no ?? "").trim() === number ||
        String(d.purchase_number ?? "").trim() === number
    );
    if (found) return found;
  }

  const against = String(refs.notes ?? "").match(/return against\s+([^\s,;)]+)/i);
  if (against) {
    const number = against[1];
    const found = inward.find(
      (d) =>
        String(d.supplier_invoice_no ?? "").trim() === number ||
        String(d.purchase_number ?? "").trim() === number
    );
    if (found) return found;
  }

  return null;
}

function batchKey(row: Row): string {
  return `${row.product_id}|${String(row.batch_no ?? "").trim().toLowerCase()}`;
}

function unitsOf(item: Row): number {
  const stored = Number(item.total_units);
  if (Number.isFinite(stored) && stored > 0) return round4(stored);

  const upp = Math.max(1, Number(item.units_per_pack) || 1);

  return round4(
    ((Number(item.pack_qty) || 0) + (Number(item.free_qty) || 0)) * upp +
      (Number(item.loose_qty) || 0) +
      (Number(item.free_loose_qty) || 0)
  );
}

/** The live debit notes that return against this bill, cancellation excluded (PUR-015). */
async function liveReturns(billId: string, exceptReturnId?: string): Promise<Row[]> {
  const bill = await sqliteStorage.findById<Row>("purchase_documents", billId);
  if (!bill) return [];

  const numbers = new Set(
    [bill.id, bill.external_id, bill.supplier_invoice_no, bill.purchase_number]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value !== "")
  );

  const records = await sqliteStorage.findAll<Row>("purchase_returns");

  return records.filter(
    (r) =>
      String(r.id) !== String(exceptReturnId ?? "") &&
      r.status !== "cancelled" &&
      (numbers.has(String(r.original_purchase_id ?? "").trim()) ||
        numbers.has(String(r.original_purchase_number ?? "").trim()))
  );
}

/**
 * Units returned against each line of the bill. Live notes are filled first and the note being
 * priced last, and a line is never filled past what it holds — so an over-keyed note cannot claim
 * more than its line took, and two part-returns together reverse exactly what one full return
 * would (PUR-015).
 */
async function returnedUnitsByItem(
  billId: string,
  opts: { exceptReturnId?: string; extraLines?: ReturnLine[] } = {}
): Promise<{ items: Row[]; returned: Record<string, number> }> {
  const items = await billItems(billId);
  const returned: Record<string, number> = {};
  for (const item of items) returned[item.id] = 0;

  const notes: Row[][] = (await liveReturns(billId, opts.exceptReturnId)).map((note) => note.lines || []);
  if (opts.extraLines?.length) notes.push(opts.extraLines);

  for (const lines of notes) {
    for (const line of lines) {
      const key = batchKey(line);
      let need = Number(line.return_qty) || 0;

      for (const item of items) {
        if (need <= 0) break;
        if (batchKey(item) !== key) continue;

        const room = round4(unitsOf(item) - returned[item.id]);
        if (room <= 0) continue;

        const take = Math.min(need, room);
        returned[item.id] = round4(returned[item.id] + take);
        need = round4(need - take);
      }
    }
  }

  return { items, returned };
}

async function billItems(billId: string): Promise<Row[]> {
  const all = await sqliteStorage.findAll<Row>("purchase_items");
  return all
    .filter((i) => String(i.purchase_id) === billId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function billCharges(billId: string): Promise<Row[]> {
  const all = await sqliteStorage.findAll<Row>("purchase_charges");
  return all
    .filter((c) => String(c.purchase_id) === billId)
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

/**
 * What the charge put on each line of the bill. An add-to-cost charge already says so in its
 * allocation rows; an expensed one leaves none, so its share of each line is derived from the
 * line's value and the remainder paisa goes on the last line, which keeps the identity
 * `Σ basis == reversibleAmount` to the paisa.
 */
async function basisByItem(charge: Row, items: Row[]): Promise<Record<string, number>> {
  const rows = (await sqliteStorage.findAll<Row>("purchase_charge_allocations")).filter(
    (a) => String(a.purchase_charge_id) === String(charge.id)
  );

  if (rows.length) {
    const basis: Record<string, number> = {};
    for (const row of rows) {
      if (!items.some((i) => String(i.id) === String(row.purchase_item_id))) continue;
      basis[String(row.purchase_item_id)] = round2(Number(row.allocated_amount) || 0);
    }
    if (Object.keys(basis).length) return basis;
  }

  if (charge.treatment !== "expense") return {};

  const total = reversibleAmount(charge);
  const values = items.map((item) => [String(item.id), Math.max(0, Number(item.taxable_amount) || 0)] as const);
  const valueTotal = values.reduce((sum, [, value]) => sum + value, 0);

  if (Math.abs(total) < PAISA || valueTotal <= 0) return {};

  const shares: Record<string, number> = {};
  let placed = 0;
  for (const [itemId, value] of values) {
    shares[itemId] = round2(total * (value / valueTotal));
    placed = round2(placed + shares[itemId]);
  }

  const last = values[values.length - 1][0];
  shares[last] = round2(shares[last] + (total - placed));

  return shares;
}

function clampTo(magnitude: number, reference: number): number {
  if (Math.abs(reference) < PAISA) return 0;

  const clamped = Math.min(Math.abs(magnitude), Math.abs(reference));

  return round2(reference < 0 ? -clamped : clamped);
}

/**
 * `Σ over the bill's lines of (what the charge put on that line × what has gone back)`. A charge
 * is never reversed past what it spread, and returning every line in full reverses every charge
 * in full.
 *
 * `charges` covers every charge line, however it was treated; `lines` covers only the ones that
 * landed on a goods line, which is the only money a landed cost ever carried.
 */
async function chargeTotals(
  billId: string,
  items: Row[],
  returned: Record<string, number>
): Promise<{ charges: Record<string, number>; lines: Record<string, number> }> {
  const charges: Record<string, number> = {};
  const lines: Record<string, number> = {};

  for (const charge of await billCharges(billId)) {
    const basis = await basisByItem(charge, items);
    // PUR-012: an expensed charge's line shares are derived only to total the reversal. The money
    // went to the expense register, so giving it back cannot move a landed cost.
    const landsOnBatch = charge.treatment !== "expense";
    let total = 0;

    for (const item of items) {
      const share = basis[item.id];
      if (share === undefined) continue;

      const units = unitsOf(item);
      const ratio = units > 0 ? Math.min(1, (returned[item.id] || 0) / units) : 0;

      // A line given back in full gives back the exact paisa it was charged.
      const reversed = ratio >= 1 ? round2(share) : round2(share * ratio);

      total = round2(total + reversed);
      if (landsOnBatch) lines[item.id] = round2((lines[item.id] || 0) + reversed);
    }

    charges[String(charge.id)] = clampTo(total, reversibleAmount(charge));
  }

  return { charges, lines };
}

/**
 * What the bill's live returns have taken back, per charge and per goods line.
 */
export async function reversalMap(
  billId: string,
  exceptReturnId?: string
): Promise<{ charges: Record<string, number>; lines: Record<string, number> }> {
  const { items, returned } = await returnedUnitsByItem(billId, { exceptReturnId });

  return chargeTotals(billId, items, returned);
}

function reversalCharge(charge: Row, amount: number, seq: number): ResolvedCharge {
  const spreadable = reversibleAmount(charge);
  const taxable = Number(charge.taxable_amount) || 0;

  // The engine prices a charge from its taxable amount, so the reversal is scaled back out of
  // the figure that also carries tax which can never be claimed.
  const net = Math.abs(spreadable) >= PAISA ? round2(amount * (taxable / spreadable)) : round2(amount);

  return {
    charge_id: `rev-${charge.id}`,
    external_id: `rev|${charge.external_id || charge.id}`,
    seq,
    head_code: String(charge.head_code),
    head_name: String(charge.head_name),
    note: `Reversed on return of the ${charge.head_name} share`,
    sac_code: charge.sac_code ?? null,
    amount: -net,
    gst_percent: Number(charge.gst_percent) || 0,
    cess_percent: Number(charge.cess_percent) || 0,
    treatment: charge.treatment,
    spread_method: "value",
    itc_eligibility: charge.itc_eligibility,
    is_rcm: Boolean(charge.is_rcm),
    paid_separately: Boolean(charge.paid_separately),
    // CR-C-11: the note gives the charge back as the bill it returns was billed, so the payable
    // membership travels with the stored flag rather than today's policy (PUR-016).
    in_payable: storedInPayable(charge),
    paid_to_label: charge.paid_to_label ?? null,
    place_of_supply: charge.place_of_supply ?? null,
    source: "return_reversal",
  } as ResolvedCharge;
}

/**
 * The charge lines a debit note carries: the part of the reversal that no other live note of this
 * bill has already claimed. Two part-returns therefore reverse exactly what one full return would,
 * to the paisa (PUR-015).
 */
export async function reversalChargesForReturn(
  billId: string,
  returnLines: ReturnLine[],
  exceptReturnId?: string
): Promise<ResolvedCharge[]> {
  if (await reversalPolicy() === "sunk") return [];

  const charges = await billCharges(billId);
  if (!charges.length) return [];

  // The backend prices a note as `cumulative reversal − reversal of the other live notes`, the
  // note already being saved by then. Here it is not saved yet, so its own lines are folded into
  // the cumulative pass instead — the same paisa either way (SYNC-007).
  const { items, returned } = await returnedUnitsByItem(billId, {
    exceptReturnId,
    extraLines: returnLines,
  });
  const due = (await chargeTotals(billId, items, returned)).charges;
  const claimed = (await reversalMap(billId, exceptReturnId)).charges;

  const out: ResolvedCharge[] = [];
  for (const charge of charges) {
    const todo = round2((due[String(charge.id)] || 0) - (claimed[String(charge.id)] || 0));
    if (Math.abs(todo) < PAISA) continue;

    out.push(reversalCharge(charge, todo, out.length + 1));
  }

  return out;
}

/**
 * The running reversal on the bill's charge rows and the landed cost its returns have taken back,
 * re-derived after every return, edit or cancellation (PUR-011, PUR-015).
 */
export async function recordReversals(billId: string): Promise<void> {
  const charges = await billCharges(billId);
  if (!charges.length) return;

  const map =
    (await reversalPolicy()) === "sunk"
      ? { charges: {} as Record<string, number>, lines: {} as Record<string, number> }
      : await reversalMap(billId);

  for (const charge of charges) {
    await sqliteStorage.updateRecord("purchase_charges", String(charge.id), {
      reversed_amount: round2(map.charges[String(charge.id)] || 0),
      updated_at: Date.now(),
    });
  }

  await reduceLandedCost(billId, map.lines);
}

/**
 * PUR-011 values a batch on what it cost to get here, so the paisa a return takes back comes out
 * of the landed cost while the supplier's own rate is untouched.
 */
async function reduceLandedCost(billId: string, reversedPerItem: Record<string, number>): Promise<void> {
  for (const item of await billItems(billId)) {
    const units = unitsOf(item);
    if (units <= 0 || !item.batch_id) continue;

    const batch = await sqliteStorage.findById<Row>("product_batches", String(item.batch_id));
    if (!batch) continue;

    const net = round2((Number(item.charge_allocation) || 0) - (reversedPerItem[String(item.id)] || 0));

    await sqliteStorage.updateRecord("product_batches", String(item.batch_id), {
      landed_cost_rate: round4((Number(item.purchase_rate) || 0) + net / units),
    });
  }
}

/**
 * A cancelled bill gives everything back (PUR-015): each charge reads as fully reversed, the batch
 * is valued at what the supplier charged, and the register entries the bill generated go with it.
 * The postings themselves stay, so the bill's own figures can still be reconciled against them.
 */
export async function reverseOnCancel(billId: string): Promise<void> {
  const charges = await billCharges(billId);
  if (!charges.length) return;

  for (const charge of charges) {
    const updates: Row = { reversed_amount: round2(reversibleAmount(charge)), updated_at: Date.now() };

    if (charge.expense_id) {
      await sqliteStorage.deleteRecord("expenses", String(charge.expense_id));
      updates.expense_id = null;
    }

    await sqliteStorage.updateRecord("purchase_charges", String(charge.id), updates);
  }

  for (const item of await billItems(billId)) {
    if (!item.batch_id) continue;
    const batch = await sqliteStorage.findById<Row>("product_batches", String(item.batch_id));
    if (!batch) continue;

    await sqliteStorage.updateRecord("product_batches", String(item.batch_id), {
      landed_cost_rate: round4(Number(item.purchase_rate) || 0),
    });
  }
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}
