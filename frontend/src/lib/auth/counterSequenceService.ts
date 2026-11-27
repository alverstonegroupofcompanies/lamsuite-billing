import { sqliteStorage } from "../db/sqliteStorage";
import { formatDocumentNumber, parseSerialNumber, type NumberingRule } from "../billing/documentNumberFormat";

/** The series every counter holds, with the tail its prefix ends in. */
export const DOC_TAILS = {
  invoice: "INV",
  sales_return: "SR",
  quotation: "QUO",
  purchase_bill: "PUR",
  receipt: "REC",
  stock_adjustment: "ADJ",
  stock_transfer: "TRF",
} as const;

export type DocType = keyof typeof DOC_TAILS;

/** Names the till's own screens and older builds use for the same series. */
export const DOC_TYPE_ALIASES: Record<string, DocType> = {
  bill: "invoice",
  sales: "invoice",
  return: "sales_return",
  credit_note: "sales_return",
  creditnote: "sales_return",
  "sales-return": "sales_return",
  estimate: "quotation",
  quotation_request: "quotation",
  purchase: "purchase_bill",
  inward: "purchase_bill",
  payment: "receipt",
  receipt_voucher: "receipt",
  adjustment: "stock_adjustment",
  "stock-adjustment": "stock_adjustment",
  transfer: "stock_transfer",
  "stock-transfer": "stock_transfer",
};

export function canonicalDocType(name: string | null | undefined): DocType | null {
  const key = String(name ?? "").trim().toLowerCase();
  if (key === "") return null;
  if (key in DOC_TAILS) return key as DocType;
  return DOC_TYPE_ALIASES[key] ?? null;
}

export interface CounterSequence {
  id: string; // `${counter_id}_${doc_type}_${fy}`
  counter_id: number | string;
  doc_type: DocType;
  financial_year: string;
  prefix: string;
  next_number: number;
  range_start?: number | null;
  range_end?: number | null;
  /**
   * How this counter renders its serial, resolved by the server from the counter's own override and
   * the store default. Absent on a series from a server that predates numbering rules, which prints
   * the bare number as it always did.
   */
  suffix?: string | null;
  serial_width?: number | null;
  pad_zeros?: boolean;
  updated_at: number;
}

/** The rule a series prints with, read off its own row. */
export function numberingRuleOf(seq: Pick<CounterSequence, "prefix" | "suffix" | "serial_width" | "pad_zeros">): NumberingRule & { prefix: string } {
  return { prefix: seq.prefix, suffix: seq.suffix, width: seq.serial_width, padZeros: seq.pad_zeros };
}

export interface SequenceManifestItem {
  counter_id: number;
  doc_type: string;
  financial_year: string;
  prefix: string;
  next_number: number;
  range_start?: number | null;
  range_end?: number | null;
  suffix?: string | null;
  serial_width?: number | null;
  pad_zeros?: boolean;
}

export interface SequenceManifest {
  counter_id: number;
  counter_code: string;
  financial_year: string;
  doc_types: string[];
  items: SequenceManifestItem[];
}

export interface LeasedBlock {
  counter_id: number | string;
  counter_code?: string;
  doc_type: string;
  financial_year: string;
  prefix: string;
  range_start: number;
  range_end: number;
  block_size?: number;
  next_number: number;
  suffix?: string | null;
  serial_width?: number | null;
  pad_zeros?: boolean;
}

export interface ActiveCounter {
  counterId: number;
  counterCode: string;
  financialYear: string;
}

const LOW_BLOCK_REMAINING = 10;

export class CounterSequenceService {
  readonly docTypes = Object.keys(DOC_TAILS) as DocType[];

  private active: ActiveCounter | null = null;

  /**
   * The POS shows a number before it can await anything, so the series the
   * counter is on is mirrored here as it is read and written.
   */
  private mirror = new Map<string, CounterSequence>();

  getCurrentFinancialYear(date = new Date()): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    // Indian FY runs April to March (month 4 to 3)
    if (month >= 4) {
      return `${year}-${String(year + 1).slice(-2)}`;
    }
    return `${year - 1}-${String(year).slice(-2)}`;
  }

  getDefaultPrefix(counterCode: string, docType: DocType): string {
    const code = (counterCode || "C01").toUpperCase();
    return `${code}-${DOC_TAILS[docType]}`;
  }

  keyFor(counterId: number | string, docType: string, financialYear: string): string | null {
    const canonical = canonicalDocType(docType);
    return canonical ? `${counterId}_${canonical}_${financialYear}` : null;
  }

  setActiveCounter(counter: { counterId: number | string; counterCode: string; financialYear?: string } | null): void {
    if (!counter) {
      this.active = null;
      return;
    }

    this.active = {
      counterId: Number(counter.counterId),
      counterCode: String(counter.counterCode || "C01").toUpperCase(),
      financialYear: counter.financialYear || this.getCurrentFinancialYear(),
    };
  }

  clearActiveCounter(): void {
    this.active = null;
    this.mirror.clear();
  }

  getActiveCounter(): ActiveCounter | null {
    return this.active;
  }

  /** Load this counter's series out of the till's store, so the POS can read them in step. */
  async hydrate(counterId: number | string, counterCode: string, financialYear?: string): Promise<void> {
    const fy = financialYear || this.getCurrentFinancialYear();
    const rows = await sqliteStorage.findAll<CounterSequence>("counter_sequences");

    for (const row of rows) {
      if (String(row.counter_id) !== String(counterId) || row.financial_year !== fy) continue;
      const canonical = canonicalDocType(row.doc_type);
      if (!canonical) continue;
      this.mirror.set(`${counterId}_${canonical}_${fy}`, { ...row, doc_type: canonical });
    }

    // A till that holds no series of its own is not on a counter's numbers yet;
    // it says so rather than starting a count the store has already used.
    if (this.hasSeries(counterId, fy)) {
      this.setActiveCounter({ counterId, counterCode, financialYear: fy });
    } else {
      this.active = null;
    }
  }

  /** Take the whole series set the server just handed out — the till's boot state. */
  async primeFromManifest(manifest: SequenceManifest): Promise<void> {
    const fy = manifest.financial_year || this.getCurrentFinancialYear();

    for (const item of manifest.items) {
      const docType = canonicalDocType(item.doc_type);
      if (!docType) continue;

      const seqId = `${manifest.counter_id}_${docType}_${fy}`;
      // The persisted row is what this till has actually issued; the in-memory
      // mirror can outlive a wiped database, and merging against it would pin
      // a fresh series to a count that no longer exists.
      const local = await sqliteStorage.findById<CounterSequence>("counter_sequences", seqId);

      // The till's cursor only moves forward: the server may not yet have heard
      // about bills this till numbered offline, so its count can be behind.
      const remoteNext = Number(item.next_number || 1001);
      const nextNumber = local ? Math.max(Number(local.next_number), remoteNext) : remoteNext;
      const hasRemoteRange = item.range_start !== null && item.range_start !== undefined && item.range_end !== null && item.range_end !== undefined;

      const seq: CounterSequence = {
        id: seqId,
        counter_id: manifest.counter_id,
        doc_type: docType,
        financial_year: item.financial_year || fy,
        prefix: item.prefix || this.getDefaultPrefix(manifest.counter_code, docType),
        next_number: nextNumber,
        range_start: hasRemoteRange ? item.range_start : (local?.range_start ?? null),
        range_end: hasRemoteRange ? item.range_end : (local?.range_end ?? null),
        suffix: item.suffix ?? local?.suffix ?? null,
        serial_width: item.serial_width ?? local?.serial_width ?? null,
        pad_zeros: item.pad_zeros ?? local?.pad_zeros ?? false,
        updated_at: Date.now(),
      };

      await sqliteStorage.insertRecord("counter_sequences", seqId, seq as unknown as Record<string, unknown>);
      this.mirror.set(seqId, seq);
    }

    this.setActiveCounter({ counterId: manifest.counter_id, counterCode: manifest.counter_code, financialYear: fy });
  }

  async getSequence(
    counterId: number | string,
    docType: string,
    customFy?: string
  ): Promise<CounterSequence | null> {
    const canonical = canonicalDocType(docType);
    if (!canonical) return null;

    const fy = customFy || this.active?.financialYear || this.getCurrentFinancialYear();
    const key = `${counterId}_${canonical}_${fy}`;
    const seq = await sqliteStorage.findById<CounterSequence>("counter_sequences", key);
    if (seq) this.mirror.set(key, { ...seq, doc_type: canonical });

    return seq ? { ...seq, doc_type: canonical } : null;
  }

  /** The number this series would give next, without taking it. */
  previewNext(counterId: number | string, docType: string, customFy?: string): string | null {
    const canonical = canonicalDocType(docType);
    if (!canonical) return null;

    const fy = customFy || this.active?.financialYear || this.getCurrentFinancialYear();
    const seq = this.mirror.get(`${counterId}_${canonical}_${fy}`);

    return seq ? formatDocumentNumber(numberingRuleOf(seq), seq.next_number) : null;
  }

  async getNextDocumentNumber(
    counterId: number | string,
    counterCode: string,
    docType: string,
    customFy?: string
  ): Promise<string> {
    const canonical = canonicalDocType(docType);

    if (!canonical) {
      throw new Error(`Unknown document series: ${String(docType)}`);
    }

    const fy = customFy || this.active?.financialYear || this.getCurrentFinancialYear();
    const seqId = `${counterId}_${canonical}_${fy}`;

    let seq = this.mirror.get(seqId) ?? (await sqliteStorage.findById<CounterSequence>("counter_sequences", seqId));

    if (!seq) {
      seq = {
        id: seqId,
        counter_id: counterId,
        doc_type: canonical,
        financial_year: fy,
        prefix: this.getDefaultPrefix(counterCode, canonical),
        next_number: 1001,
        range_start: null,
        range_end: null,
        suffix: null,
        serial_width: null,
        pad_zeros: false,
        updated_at: Date.now(),
      };
    }

    const currentNumber = seq.next_number;

    // A block the counter leased runs out; the till must ask for another rather
    // than invent numbers the server has not reserved.
    if (seq.range_end && currentNumber > seq.range_end) {
      throw new Error(
        `Leased sequence range exhausted for counter ${counterCode} (range: ${seq.range_start}-${seq.range_end}). Request new block from store server.`
      );
    }

    const formattedNumber = formatDocumentNumber(numberingRuleOf(seq), currentNumber);

    seq = { ...seq, id: seqId, doc_type: canonical, next_number: currentNumber + 1, updated_at: Date.now() };
    await sqliteStorage.insertRecord("counter_sequences", seqId, seq as unknown as Record<string, unknown>);
    this.mirror.set(seqId, seq);

    return formattedNumber;
  }

  /**
   * A number taken while the till cannot reach the server has to be one the
   * server reserved: an unleased series would hand out numbers the store's book
   * may already hold, so the caller falls back to a temporary marker and the
   * counter renumbers the document when it is pushed.
   */
  async takeLeasedNumber(
    counterId: number | string,
    counterCode: string,
    docType: string,
    customFy?: string
  ): Promise<string> {
    const canonical = canonicalDocType(docType);

    if (!canonical) {
      throw new Error(`Unknown document series: ${String(docType)}`);
    }

    const seq = await this.getSequence(counterId, canonical, customFy);

    if (!seq || seq.range_start === null || seq.range_start === undefined || !seq.range_end) {
      throw new Error(`No leased number block for counter ${counterCode} series ${String(docType)}.`);
    }

    return await this.getNextDocumentNumber(counterId, counterCode, canonical, customFy);
  }

  async saveLeasedBlock(block: LeasedBlock): Promise<CounterSequence> {
    const canonical = canonicalDocType(block.doc_type);

    if (!canonical) {
      throw new Error(`Unknown document series: ${String(block.doc_type)}`);
    }

    const fy = block.financial_year || this.getCurrentFinancialYear();
    const seqId = `${block.counter_id}_${canonical}_${fy}`;

    // Compare against the persisted series, not the mirror: a mirror entry can
    // outlive a wiped database, and a fresh block must not inherit its count.
    const local = await sqliteStorage.findById<CounterSequence>("counter_sequences", seqId);

    // The server hands back a block; the till's cursor within it never rewinds,
    // even if the server has not yet caught up with bills numbered offline.
    const blockNext = Number(block.next_number || block.range_start);
    const seq: CounterSequence = {
      id: seqId,
      counter_id: block.counter_id,
      doc_type: canonical,
      financial_year: fy,
      prefix: block.prefix || this.getDefaultPrefix(block.counter_code || "C01", canonical),
      next_number: local ? Math.max(Number(local.next_number), blockNext) : blockNext,
      range_start: Number(block.range_start),
      range_end: Number(block.range_end),
      suffix: block.suffix ?? local?.suffix ?? null,
      serial_width: block.serial_width ?? local?.serial_width ?? null,
      pad_zeros: block.pad_zeros ?? local?.pad_zeros ?? false,
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("counter_sequences", seqId, seq as unknown as Record<string, unknown>);
    this.mirror.set(seqId, seq);

    return seq;
  }

  /** Does this till hold any of the counter's series yet? */
  hasSeries(counterId: number | string, financialYear?: string): boolean {
    const fy = financialYear || this.active?.financialYear || this.getCurrentFinancialYear();

    return Array.from(this.mirror.keys()).some((key) => key.startsWith(`${counterId}_`) && key.endsWith(`_${fy}`));
  }

  /**
   * Read the counter's series off the store server. A till that lost its own
   * numbers — an upgrade, a reinstall, a second machine on the same counter —
   * boots onto the server's count instead of restarting a series the store's
   * book has already moved past.
   */
  async pull(options: {
    baseUrl: string;
    token?: string | null;
    storeId?: string;
  }): Promise<SequenceManifest | null> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.token) headers["X-Device-Token"] = options.token;
    if (options.storeId) headers["X-Store-Id"] = String(options.storeId);

    const res = await fetch(`${options.baseUrl}/api/counter/sequences`, { method: "GET", headers });

    if (!res.ok) {
      throw new Error(`Counter series fetch failed with HTTP ${res.status}`);
    }

    const manifest = (await res.json()) as SequenceManifest;

    if (!manifest?.items?.length) return null;

    await this.primeFromManifest(manifest);

    return manifest;
  }

  /** Reserve the next block of this counter's series on the store server. */
  async lease(
    counterId: number | string,
    docType: string,
    blockSize = 50,
    options: { baseUrl: string; token?: string | null; storeId?: string }
  ): Promise<LeasedBlock> {
    const canonical = canonicalDocType(docType);

    if (!canonical) {
      throw new Error(`Unknown document series: ${String(docType)}`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (options.storeId) headers["X-Store-Id"] = String(options.storeId);
    if (options.token) headers["X-Device-Token"] = options.token;

    // A lease reserves; it does not spend. When this till still holds a block,
    // it reports how far it actually got so the server closes that block instead
    // of guessing — and a second ask with nothing new spent changes nothing.
    const body: Record<string, unknown> = { doc_type: canonical, block_size: blockSize };
    const local = await this.getSequence(counterId, canonical);
    if (local && local.range_end !== null && local.range_end !== undefined && local.range_start) {
      const usedThrough = Math.min(Number(local.next_number) - 1, Number(local.range_end));
      if (usedThrough >= Number(local.range_start)) body.used_through = usedThrough;
    }

    const res = await fetch(`${options.baseUrl}/api/counter/sequences/lease`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Counter sequence lease failed with HTTP ${res.status}`);
    }

    const block = (await res.json()) as LeasedBlock;
    await this.saveLeasedBlock(block);

    return block;
  }

  /** How much of the leased block is left — a series without one needs a lease. */
  async leaseStatus(
    counterId: number | string,
    docType: string,
    customFy?: string
  ): Promise<{ remaining: number; isLow: boolean }> {
    const seq = await this.getSequence(counterId, docType, customFy);

    if (!seq || seq.range_end === null || seq.range_end === undefined) {
      return { remaining: 0, isLow: true };
    }

    const remaining = Math.max(0, seq.range_end - seq.next_number + 1);

    return { remaining, isLow: remaining < LOW_BLOCK_REMAINING };
  }

  /** The counter series this till bills from, or null while it has none. */
  previewForActive(docType: string): string | null {
    if (!this.active) return null;

    return this.previewNext(this.active.counterId, docType, this.active.financialYear);
  }

  async numberFromActiveCounter(docType: string, consume: boolean): Promise<string | null> {
    if (!this.active) return null;

    if (!consume) {
      return this.previewForActive(docType);
    }

    return await this.getNextDocumentNumber(
      this.active.counterId,
      this.active.counterCode,
      docType,
      this.active.financialYear
    );
  }

  /**
   * The counter filed a document under one of its own numbers, so the till steps
   * its mirror past it. A number from another series is not this counter's.
   */
  async stepOverForActiveCounter(number: string): Promise<void> {
    if (!this.active || !number) return;

    const text = String(number).trim().toUpperCase();
    const docType = await this.seriesOwning(text);
    if (!docType) return;

    const seq = await this.getSequence(this.active.counterId, docType, this.active.financialYear);
    if (!seq) return;

    // The serial is read back through the series' own rule: `C01-SR-00001/26` carries neither a
    // bare integer nor a last dash-segment, and reading it wrong leaves the cursor behind.
    const part = parseSerialNumber(text, seq.suffix);
    if (part === null || part < seq.next_number) return;

    seq.next_number = part + 1;
    seq.updated_at = Date.now();
    await sqliteStorage.insertRecord("counter_sequences", seq.id, seq as unknown as Record<string, unknown>);
    this.mirror.set(seq.id, seq);
  }

  /** Which of the active counter's series prints a given number, judged by the prefix that series actually uses. */
  private async seriesOwning(text: string): Promise<DocType | null> {
    if (!this.active) return null;

    for (const docType of this.docTypes) {
      const key = `${this.active.counterId}_${docType}_${this.active.financialYear}`;
      const seq = this.mirror.get(key) ?? (await this.getSequence(this.active.counterId, docType, this.active.financialYear));
      const prefix = String(seq?.prefix || this.getDefaultPrefix(this.active.counterCode, docType)).toUpperCase();
      if (text.startsWith(`${prefix}-`)) return docType;
    }

    return null;
  }
}

export const counterSequenceService = new CounterSequenceService();
