import { sqliteStorage } from "../db/sqliteStorage";

export type DocType = "invoice" | "return" | "receipt" | "transfer";

export interface CounterSequence {
  id: string; // `${counter_id}_${doc_type}_${fy}`
  counter_id: string;
  doc_type: DocType;
  financial_year: string;
  prefix: string;
  next_number: number;
  range_start?: number;
  range_end?: number;
  updated_at: number;
}

export class CounterSequenceService {
  getCurrentFinancialYear(date = new Date()): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    // Indian FY runs April to March (month 4 to 3)
    if (month >= 4) {
      const nextYearShort = String(year + 1).slice(-2);
      return `${year}-${nextYearShort}`;
    } else {
      const currentYearShort = String(year).slice(-2);
      return `${year - 1}-${currentYearShort}`;
    }
  }

  getDefaultPrefix(counterCode: string, docType: DocType): string {
    const code = (counterCode || "C01").toUpperCase();
    switch (docType) {
      case "invoice":
        return `${code}-INV`;
      case "return":
        return `${code}-SR`;
      case "receipt":
        return `${code}-REC`;
      case "transfer":
        return `${code}-TRF`;
      default:
        return `${code}-DOC`;
    }
  }

  async getNextDocumentNumber(
    counterId: string,
    counterCode: string,
    docType: DocType = "invoice",
    customFy?: string
  ): Promise<string> {
    const fy = customFy || this.getCurrentFinancialYear();
    const seqId = `${counterId}_${docType}_${fy}`;

    let seq = await sqliteStorage.findById<CounterSequence>("counter_sequences", seqId);

    if (!seq) {
      const defaultPrefix = this.getDefaultPrefix(counterCode, docType);
      seq = {
        id: seqId,
        counter_id: counterId,
        doc_type: docType,
        financial_year: fy,
        prefix: defaultPrefix,
        next_number: 1001,
        updated_at: Date.now(),
      };
    }

    const currentNumber = seq.next_number;

    // Check leased block boundary if defined
    if (seq.range_end && currentNumber > seq.range_end) {
      throw new Error(
        `Leased sequence range exhausted for counter ${counterCode} (range: ${seq.range_start}-${seq.range_end}). Request new block from store server.`
      );
    }

    const formattedNumber = `${seq.prefix}-${currentNumber}`;

    // Increment and persist sequentially
    seq.next_number = currentNumber + 1;
    seq.updated_at = Date.now();
    await sqliteStorage.insertRecord("counter_sequences", seqId, seq);

    return formattedNumber;
  }

  async configureSequence(
    counterId: string,
    docType: DocType,
    prefix: string,
    startingNumber = 1001,
    rangeStart?: number,
    rangeEnd?: number,
    customFy?: string
  ): Promise<CounterSequence> {
    const fy = customFy || this.getCurrentFinancialYear();
    const seqId = `${counterId}_${docType}_${fy}`;

    const seq: CounterSequence = {
      id: seqId,
      counter_id: counterId,
      doc_type: docType,
      financial_year: fy,
      prefix,
      next_number: startingNumber,
      range_start: rangeStart,
      range_end: rangeEnd,
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("counter_sequences", seqId, seq);
    return seq;
  }

  async getSequence(counterId: string, docType: DocType, customFy?: string): Promise<CounterSequence | null> {
    const fy = customFy || this.getCurrentFinancialYear();
    const seqId = `${counterId}_${docType}_${fy}`;
    return await sqliteStorage.findById<CounterSequence>("counter_sequences", seqId);
  }
}

export const counterSequenceService = new CounterSequenceService();
