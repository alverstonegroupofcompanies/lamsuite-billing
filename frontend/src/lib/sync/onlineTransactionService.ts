import { sqliteStorage } from "../db/sqliteStorage";
import { canonicalizeInvoiceIdentity, clearInvoiceChildren } from "../db/invoiceCacheIdentity";
import { getResolvedApiBaseUrl } from "../../config/env";
import { counterSequenceService, type DocType } from "../auth/counterSequenceService";
import { storeDeviceService, counterSequenceKey } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { syncQueueService } from "./syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { storeToday } from "../dateTimeUtils";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import { stateCodeOf, stateLabel } from "../gst/stateCodes";
import { parseBusinessRuleError, type BusinessRuleErrorPayload } from "../errors/businessRuleError";
import { billingTenderService, type PaymentTenderLine } from "../billing/billingTenderService";
import { withoutPharmacistPin } from "../billing/pharmacistGate";

export type ConnectionState = "online" | "slow" | "offline";

export interface NetworkHealth {
  state: ConnectionState;
  latencyMs: number;
  lastOnlineTimestamp: number;
  timeSinceLastOnlineMs: number;
  pendingQueueCount: number;
  isLeaseBlockLow: boolean;
  remainingLeaseCount: number;
}

export interface OnlineInvoiceLinePayload {
  product_id: string;
  product_name?: string;
  batch_id?: string;
  batch_no?: string;
  expiry_date?: string;
  qty: number;
  loose_qty?: number;
  free_qty?: number;
  free_loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent?: number;
  rate_basis?: string;
}

export interface OnlineInvoicePayload {
  store_id?: string | number;
  store_code?: string;
  idempotency_key?: string;
  external_id?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  payment_mode?: string;
  paid_amount?: number;
  payments?: PaymentTenderLine[];
  counter_id?: string;
  counter_code?: string;
  location_name?: string;
  patient_name?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  salesperson_id?: string;
  salesperson_name?: string;
  /** PHR-004: who vouched for a restricted line, and the PIN they typed. */
  pharmacist_id?: string;
  pharmacist_pin?: string;
  bill_discount_percent?: number;
  bill_discount_amount?: number;
  manual_round_off?: number | null;
  subtotal?: number;
  discount_total?: number;
  tax_total?: number;
  round_off?: number;
  grand_total?: number;
  tax_mode?: string;
  store_state?: string;
  gst_type?: string;
  is_composition?: boolean;
  is_inter_state?: boolean;
  is_offline_temp?: boolean;
  /** APR-003: the grant an approver minted for this bill, redeemed on save. */
  approval_token?: string;
  approval_reason?: string;
  items: OnlineInvoiceLinePayload[];
}

export interface AuthoritativeInvoiceResponse {
  success: boolean;
  isOnline: boolean;
  isOfflineQueued?: boolean;
  isTempNumber?: boolean;
  invoice: any;
  affectedBatches?: Array<{
    product_id: number | string;
    batch_id: number | string;
    batch_no: string;
    remaining_stock: number;
  }>;
  tempMappedFrom?: string;
  error?: string;
  /** Structured business-rule payload from the server (code/rule/line/fix). */
  businessRule?: BusinessRuleErrorPayload;
}

export class OnlineTransactionService {
  private connectionState: ConnectionState = "online";
  private lastLatencyMs = 45;
  private lastOnlineTimestamp = Date.now();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(health: NetworkHealth) => void>();
  private activeBaseUrl?: string;
  /** One lease request at a time, so a heartbeat cannot stack a second block. */
  private leaseRequest: Promise<boolean> | null = null;

  constructor(baseUrl?: string) {
    this.activeBaseUrl = baseUrl;
    this.startHealthMonitor();
  }

  setBaseUrl(url: string) {
    this.activeBaseUrl = url;
  }

  setConnectionState(state: ConnectionState) {
    this.connectionState = state;
  }

  getEffectiveBaseUrl(): string {
    return this.activeBaseUrl || getResolvedApiBaseUrl();
  }

  /**
   * Continuous Health Monitor: fast heartbeat check to detect online / slow (>800ms) / offline.
   */
  startHealthMonitor(intervalMs = 4000) {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      await this.checkConnectionHealth();
    }, intervalMs);

    // Initial check
    this.checkConnectionHealth();
  }

  stopHealthMonitor() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async checkConnectionHealth(): Promise<NetworkHealth> {
    const start = Date.now();
    let isConnected = false;
    let latency = 0;

    const baseUrl = this.getEffectiveBaseUrl();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const activeStore = storeRegistryService.getActiveStore();

      // Before a counter is claimed there is no store to name. Probe the
      // server's health route instead of asking about store 1's licence.
      if (!activeStore) {
        const res = await fetch(`${baseUrl}/up`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        latency = Date.now() - start;
        isConnected = res.ok;
      } else {
        const activeStoreId = String(activeStore.id);

        const res = await fetch(`${baseUrl}/api/license/check?store_id=${encodeURIComponent(activeStoreId)}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Store-Id": activeStoreId,
            "Store-Id": activeStoreId,
          },
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        latency = Date.now() - start;
        if (res.ok) {
          isConnected = true;
          const body = await res.json().catch(() => ({}));
          if (body && body.is_active !== undefined) {
            const isActive = Boolean(body.is_active);
            if (activeStore.is_active !== isActive) {
              await storeRegistryService.setStoreActiveStatus(activeStore.id, isActive);
              await companySettingsService.updateLocalFromRemote({ is_active: isActive });
            }
          }
          if (body && body.last_reset_at) {
            const storeId = String(body.store_id || activeStore.id || "");
            await storeRegistryService.applyRemoteResetOnce(
              storeId,
              body.last_reset_at,
              body.last_reset_options || undefined
            );
          }
        }
      }
    } catch {
      // Server unreachable
    }

    if (!isConnected) {
      latency = Date.now() - start;
    }

    const previousState = this.connectionState;

    if (isConnected) {
      this.lastOnlineTimestamp = Date.now();
      this.lastLatencyMs = latency;
      this.connectionState = latency > 800 ? "slow" : "online";

      // If we just reconnected from offline mode, trigger automatic sync-back!
      if (previousState === "offline") {
        this.triggerAutomaticReconnectionSync();
      }
    } else {
      this.connectionState = "offline";
    }

    const pendingQueue = await this.getPendingQueueCount();
    const leaseStatus = await this.checkLeaseBlockStatus();

    const health: NetworkHealth = {
      state: this.connectionState,
      latencyMs: this.lastLatencyMs,
      lastOnlineTimestamp: this.lastOnlineTimestamp,
      timeSinceLastOnlineMs: Date.now() - this.lastOnlineTimestamp,
      pendingQueueCount: pendingQueue,
      isLeaseBlockLow: leaseStatus.isLow,
      remainingLeaseCount: leaseStatus.remaining,
    };

    this.notifyListeners(health);
    return health;
  }

  subscribe(listener: (health: NetworkHealth) => void): () => void {
    this.listeners.add(listener);
    this.getHealthSnapshot().then((h) => listener(h));
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(health: NetworkHealth) {
    this.listeners.forEach((fn) => {
      try {
        fn(health);
      } catch (err) {
        console.warn("Error in network health listener", err);
      }
    });
  }

  async getHealthSnapshot(): Promise<NetworkHealth> {
    const pendingQueue = await this.getPendingQueueCount();
    const leaseStatus = await this.checkLeaseBlockStatus();
    return {
      state: this.connectionState,
      latencyMs: this.lastLatencyMs,
      lastOnlineTimestamp: this.lastOnlineTimestamp,
      timeSinceLastOnlineMs: Date.now() - this.lastOnlineTimestamp,
      pendingQueueCount: pendingQueue,
      isLeaseBlockLow: leaseStatus.isLow,
      remainingLeaseCount: leaseStatus.remaining,
    };
  }

  async getPendingQueueCount(): Promise<number> {
    try {
      const pending = await syncQueueService.getPendingItems();
      return pending.length;
    } catch {
      return 0;
    }
  }

  /**
   * Check status of this counter's leased number block and ask for more only
   * when it is actually spent. CNT-014: the block belongs to the counter, the
   * server reserves it, and a heartbeat must never burn the series.
   */
  async checkLeaseBlockStatus(docType: DocType = "invoice"): Promise<{ remaining: number; isLow: boolean }> {
    try {
      const profile = await storeDeviceService.getDeviceProfile();
      if (!profile) return { remaining: 0, isLow: true };

      const counterId = counterSequenceKey(profile, profile.counter_code);
      const status = await counterSequenceService.leaseStatus(counterId, docType);

      if (status.remaining === 0 && this.connectionState !== "offline") {
        void this.replenishLeasedBlock(counterId, docType);
      }

      return status;
    } catch {
      return { remaining: 0, isLow: true };
    }
  }

  /**
   * Request a new reserved block of numbers from the store server, keyed by the
   * counter's own id. One request at a time: the heartbeat runs every few
   * seconds and a stack of asks is what used to open block after block.
   */
  async replenishLeasedBlock(counterId: number | string, docType: DocType = "invoice", blockSize = 50): Promise<boolean> {
    if (this.leaseRequest) return this.leaseRequest;

    this.leaseRequest = (async () => {
      try {
        const profile = await storeDeviceService.getDeviceProfile();
        const activeStore = storeRegistryService.getActiveStore();
        const storeId = String(activeStore?.id || profile?.store_id || "");

        await counterSequenceService.lease(counterId, docType, blockSize, {
          baseUrl: this.getEffectiveBaseUrl(),
          token: await storeDeviceService.getDeviceToken(),
          storeId: /^\d+$/.test(storeId) ? storeId : undefined,
        });

        return true;
      } catch {
        return false;
      } finally {
        this.leaseRequest = null;
      }
    })();

    return this.leaseRequest;
  }

  /**
   * Primary Online Transaction Execution:
   * Submits to Cloud Backend API first. On success, updates local SQLite cache.
   * On network timeout or connection failure, seamlessly degrades to offline fallback.
   */
  async submitAuthoritativeInvoice(payload: OnlineInvoicePayload): Promise<AuthoritativeInvoiceResponse> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = storeRegistryService.getActiveStore();
    const resolvedStoreId = String(payload.store_id || activeStore?.id || profile?.store_id || "1");
    const resolvedStoreCode = String(payload.store_code || activeStore?.code || profile?.store_code || "STORE-01");
    const counterCode = payload.counter_code || profile?.counter_code || "C01";
    const idempotencyKey = payload.idempotency_key || payload.external_id || `tx_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    const effectivePayload: OnlineInvoicePayload = {
      ...payload,
      store_id: resolvedStoreId,
      store_code: resolvedStoreCode,
      idempotency_key: idempotencyKey,
      counter_code: counterCode,
    };

    if (activeStore && activeStore.is_active === false) {
      throw new Error("Store is currently disabled by Admin. Invoicing and transactions are prohibited.");
    }

    // If currently online or slow, attempt live server transaction first
    if (this.connectionState !== "offline") {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

        const res = await fetch(`${this.getEffectiveBaseUrl()}/api/invoices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Store-Id": resolvedStoreId,
            "Store-Id": resolvedStoreId,
          },
          body: JSON.stringify(effectivePayload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json();

        if (res.status === 403 && data.error === "STORE_DISABLED") {
          if (activeStore) {
            await storeRegistryService.setStoreActiveStatus(activeStore.id, false);
            await companySettingsService.updateLocalFromRemote({ is_active: false });
          }
          throw new Error(data.message || "Store is disabled by administration. Invoicing prohibited.");
        }

        if (res.ok && data.success) {
          // 1. Live server write succeeded!
          const authoritativeInvoice = data.invoice;

          // 2. Update local SQLite cache from authoritative response
          await this.syncAuthoritativeInvoiceToLocalCache(authoritativeInvoice, data.affected_batches);

          this.lastOnlineTimestamp = Date.now();
          this.connectionState = "online";

          return {
            success: true,
            isOnline: true,
            invoice: authoritativeInvoice,
            affectedBatches: data.affected_batches,
            tempMappedFrom: data.temp_mapped_from,
          };
        } else if (res.status === 422) {
          // Business rule violation (period lock, credit limit, out of stock).
          // Keep the structured payload so the till can point at the exact line.
          const businessRule = parseBusinessRuleError(data);
          return {
            success: false,
            isOnline: true,
            invoice: null,
            error: businessRule?.message || data.error || "Transaction rejected by business rules.",
            businessRule: businessRule ?? undefined,
          };
        }
      } catch (networkErr: any) {
        console.warn("Server live transaction failed or timed out. Falling back to offline mode.", networkErr);
        this.connectionState = "offline";
      }
    }

    // Degraded Offline Fallback
    return await this.executeOfflineFallbackInvoice(effectivePayload, counterCode, idempotencyKey);
  }

  /**
   * Offline Mode Execution:
   * 1. Obtains a number the server pre-leased; refuses to bill when the block is spent
   * 2. Persists durable write-ahead queue entry (WAL)
   * 3. Updates local SQLite cache and pending stock ledger
   * 4. Enqueues in syncQueueService for reconnect sync
   */
  private async executeOfflineFallbackInvoice(
    payload: OnlineInvoicePayload,
    counterCode: string,
    idempotencyKey: string
  ): Promise<AuthoritativeInvoiceResponse> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = storeRegistryService.getActiveStore();
    const resolvedStoreId = String(payload.store_id || activeStore?.id || profile?.store_id || "1");
    const resolvedStoreCode = String(payload.store_code || activeStore?.code || profile?.store_code || "STORE-01");
    const counterId = counterSequenceKey(profile, counterCode);

    let assignedDocNumber = payload.invoice_number || "";

    if (!assignedDocNumber) {
      try {
        assignedDocNumber = await counterSequenceService.takeLeasedNumber(counterId, counterCode, "invoice");
      } catch {
        // A number the server never reserved is not this store's to issue, so the
        // bill stops here rather than inventing one that may collide in the book.
        return {
          success: false,
          isOnline: false,
          invoice: null,
          error:
            "This till has no offline invoice numbers left. Connect it to the store server to lease a new block, then bill again.",
        };
      }
    }

    const now = Date.now();
    const invoiceId = `offline_inv_${now}_${Math.random().toString(16).slice(2, 6)}`;

    // Authoritative calculation via tax engine
    const storeSettings = companySettingsService.getSettings();
    const stState = payload.store_state || storeSettings.state_code || "32";
    const gstType = payload.gst_type || storeSettings.gst_type || "regular";
    const taxMode = (payload.tax_mode as any) || storeSettings.tax_mode || "inclusive";

    // A walk-in bill is supplied where the store is. Only the buyer's GSTIN — or
    // the destination the caller resolved for a registered customer — may move it.
    const posLabel = stateLabel(
      stateCodeOf(payload.customer_gstin) ?? (payload.is_inter_state ? payload.place_of_supply : null),
      stState
    );

    const docTaxes = calculateDocumentTaxes({
      store_state: stState,
      customer_gstin: payload.customer_gstin,
      place_of_supply: posLabel,
      default_tax_mode: taxMode,
      gst_type: gstType as any,
      is_composition: payload.is_composition || gstType === "composition" || gstType === "no_tax",
      lines: payload.items.map((item, idx) => ({
        line_id: `L${idx}`,
        product_id: item.product_id,
        product_name: item.product_name,
        qty: Number(item.qty ?? 0),
        loose_qty: Number(item.loose_qty || 0),
        free_qty: Number(item.free_qty || 0),
        free_loose_qty: Number(item.free_loose_qty || 0),
        units_per_pack: Number(item.units_per_pack || 1),
        unit_price: Number(item.unit_price || 0),
        mrp: item.mrp ? Number(item.mrp) : undefined,
        rate_basis: item.rate_basis as any,
        discount_percent: Number(item.discount_percent || 0),
        discount_amount: Number(item.discount_amount || 0),
        gst_percent: Number(item.gst_percent || 0),
      })),
      bill_discount: {
        type: payload.bill_discount_percent ? "percent" : "amount",
        value: Number(payload.bill_discount_percent || payload.bill_discount_amount || 0),
      },
      auto_round_off: payload.manual_round_off === undefined || payload.manual_round_off === null,
      manual_round_off: payload.manual_round_off !== undefined ? payload.manual_round_off : null,
    });

    const lineRecords: any[] = [];
    for (let i = 0; i < docTaxes.lines.length; i++) {
      const cLine = docTaxes.lines[i];
      const rawItem = payload.items[i];
      const lineItemId = `inv_item_${now}_${Math.random().toString(16).slice(2, 6)}`;

      lineRecords.push({
        id: lineItemId,
        invoice_id: invoiceId,
        product_id: cLine.product_id || rawItem.product_id,
        product_name: cLine.product_name || rawItem.product_name || "Product",
        batch_no: rawItem.batch_no || "BATCH-01",
        expiry_date: rawItem.expiry_date,
        qty: cLine.qty,
        loose_qty: cLine.loose_qty,
        free_qty: Math.max(0, Number(rawItem.free_qty) || 0),
        free_loose_qty: Math.max(0, Number(rawItem.free_loose_qty) || 0),
        units_per_pack: cLine.units_per_pack,
        unit_price: cLine.unit_price,
        mrp: rawItem.mrp || cLine.unit_price,
        discount_percent: rawItem.discount_percent || 0,
        discount_amount: cLine.line_discount,
        allocated_discount: cLine.allocated_bill_discount,
        taxable_amount: cLine.taxable_amount,
        gst_percent: cLine.gst_rate,
        cgst_amount: cLine.cgst_amount,
        sgst_amount: cLine.sgst_amount,
        igst_amount: cLine.igst_amount,
        cess_rate: cLine.cess_rate,
        cess_amount: cLine.cess_amount,
        tax_amount: cLine.total_tax,
        total_amount: cLine.total_amount,
      });
    }

    const calculatedSubtotal = docTaxes.gross_subtotal;
    const taxableSubtotal = docTaxes.taxable_subtotal;
    const discountTotal = docTaxes.line_discount_total + docTaxes.bill_discount_total;
    const taxTotal = docTaxes.total_tax;
    const finalRoundOff = docTaxes.round_off;
    const finalGrandTotal = docTaxes.grand_total;

    const requestedLines = payload.payments && payload.payments.length > 0
      ? payload.payments
      : [{ mode: payload.payment_mode || "Cash", amount: payload.paid_amount ?? finalGrandTotal }];

    // PAY-02: the till's own copy of the bill reads the way the server reads
    // it — `amount` is what the bill kept, `tendered_amount` what the customer
    // handed over and `change_amount` what went back. Re-settling settled
    // lines is a no-op, so a bill that arrives from either till version keeps
    // one set of numbers here and on the server.
    const settledTenders = billingTenderService.settleTenders(finalGrandTotal, requestedLines);
    const paymentLines = settledTenders.lines;
    const creditPortion = settledTenders.credit;
    const totalPaid = settledTenders.paid;

    const primaryMode = paymentLines.length > 1 ? "Split" : (paymentLines[0]?.mode || "Cash");
    let paymentStatus = "paid";
    if (creditPortion >= finalGrandTotal - 0.01) {
      paymentStatus = "unpaid";
    } else if (creditPortion > 0.001 || totalPaid < finalGrandTotal - 0.01) {
      paymentStatus = "partially_paid";
    }

    // PHR-006: what the till keeps is who confirmed, never what they typed. An
    // offline bill names its pharmacist from the device's own staff cache, and
    // the server re-checks the credential when the document lands.
    const confirmedBy = payload.pharmacist_id
      ? await sqliteStorage.findById<any>("salespeople", String(payload.pharmacist_id))
      : null;

    // Build local invoice record
    const invoiceRecord = {
      id: invoiceId,
      store_id: resolvedStoreId,
      store_code: resolvedStoreCode,
      module_key: "invoice",
      invoice_number: assignedDocNumber,
      invoice_date: payload.invoice_date || storeToday(companySettingsService.getSettings()),
      customer_id: payload.customer_id || "",
      customer_name: payload.customer_name || "Walk-in Customer",
      customer_phone: payload.customer_phone || "",
      customer_gstin: payload.customer_gstin || "",
      place_of_supply: posLabel,
      subtotal: calculatedSubtotal,
      taxable_subtotal: taxableSubtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      cgst_total: docTaxes.cgst_total,
      sgst_total: docTaxes.sgst_total,
      igst_total: docTaxes.igst_total,
      cess_total: docTaxes.cess_total,
      store_state_code: docTaxes.store_state,
      round_off: finalRoundOff,
      grand_total: finalGrandTotal,
      paid_amount: totalPaid,
      payment_mode: primaryMode,
      payment_status: paymentStatus,
      status: "issued",
      counter_id: counterId,
      counter_code: counterCode,
      patient_name: payload.patient_name || "",
      doctor_name: payload.doctor_name || "",
      doctor_reg_no: payload.doctor_reg_no || "",
      salesperson_id: payload.salesperson_id || "",
      salesperson_name: payload.salesperson_name || "",
      pharmacist_id: payload.pharmacist_id || "",
      pharmacist_name: confirmedBy?.name || "",
      pharmacist_reg_no: confirmedBy?.reg_no || "",
      pharmacist_confirmed_at: confirmedBy ? now : 0,
      is_offline: true,
      is_offline_temp: false,
      sync_state: "pending",
      created_at: now,
      updated_at: now,
      items: lineRecords,
    };

    // PHR-006: a PIN is evidence for the one request it was typed into. What
    // lands on disk is who the store named, never what they typed — the server
    // re-checks the confirmation when the document arrives.
    const queuedPayload = withoutPharmacistPin(payload);

    // 1. Write to Durable Write-Ahead Queue (WAL) on disk/SQLite to survive crashes
    await sqliteStorage.insertRecord("offline_durable_queue", idempotencyKey, {
      id: idempotencyKey,
      store_id: resolvedStoreId,
      entity_type: "invoice",
      document_number: assignedDocNumber,
      payload_json: JSON.stringify({
        ...queuedPayload,
        store_id: resolvedStoreId,
        store_code: resolvedStoreCode,
        invoice_number: assignedDocNumber,
        is_offline_temp: false,
      }),
      status: "pending",
      created_at: now,
    });

    // 2. Commit to local SQLite cache so POS screen and print templates render immediately
    await sqliteStorage.insertRecord("invoices", invoiceId, invoiceRecord);

    // Commit line items
    for (const lineRec of lineRecords) {
      await sqliteStorage.insertRecord("invoice_items", lineRec.id, lineRec);
    }

    // Commit invoice payments
    for (let pIdx = 0; pIdx < paymentLines.length; pIdx++) {
      const p = paymentLines[pIdx];
      const pId = p.id || `pay_${now}_${pIdx}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("invoice_payments", pId, {
        id: pId,
        store_id: resolvedStoreId,
        invoice_id: invoiceId,
        counter_id: counterId,
        counter_code: counterCode,
        payment_mode: p.mode || "Cash",
        amount: Number(p.amount) || 0,
        tendered_amount: Number(p.tendered_amount ?? p.amount) || 0,
        change_amount: Number(p.change_amount) || 0,
        reference_no: p.reference_no || null,
        status: p.status || "received",
        extra_fields: p.extra_fields ? JSON.stringify(p.extra_fields) : null,
        notes: p.notes || null,
        received_by: "Counter " + counterCode,
        created_at: now,
        updated_at: now,
      });
    }

    if (creditPortion > 0 && payload.customer_id) {
      const existingCust = await sqliteStorage.findById<any>("customers", payload.customer_id);
      if (existingCust) {
        await sqliteStorage.insertRecord("customers", payload.customer_id, {
          ...existingCust,
          current_balance: (Number(existingCust.current_balance) || 0) + creditPortion,
          outstanding_balance: (Number(existingCust.outstanding_balance) || 0) + creditPortion,
          updated_at: now,
        });
      }
    }

    // 3. Update local batch stock cache and write stock transactions
    for (const item of payload.items) {
      const batchKey = item.batch_id || item.batch_no;
      const upp = Math.max(1, Number(item.units_per_pack) || 1);
      const billedUnits = (Number(item.qty || 0) * upp) + (Number(item.loose_qty) || 0);
      const freeUnits = (Math.max(0, Number(item.free_qty) || 0) * upp) + Math.max(0, Number(item.free_loose_qty) || 0);
      const qtyDeducted = billedUnits + freeUnits;

      if (batchKey) {
        const existingBatch = await sqliteStorage.findById<any>("product_batches", batchKey);
        if (existingBatch) {
          await sqliteStorage.insertRecord("product_batches", batchKey, {
            ...existingBatch,
            stock_qty: (Number(existingBatch.stock_qty) || 0) - qtyDeducted,
            updated_at: now,
          });
        }
      }

      const prod = await sqliteStorage.findById<any>("products", item.product_id);
      if (prod) {
        await sqliteStorage.insertRecord("products", item.product_id, {
          ...prod,
          current_stock: (Number(prod.current_stock) || 0) - qtyDeducted,
          updated_at: now,
        });
      }

      const stockTxId = `stk_tx_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        store_id: resolvedStoreId,
        product_id: item.product_id,
        batch_id: batchKey || "batch_default",
        event_type: "SALE",
        qty_delta: -qtyDeducted,
        reference_type: "INVOICE",
        reference_id: invoiceId,
        counter_id: counterId,
        created_at: now,
      });
    }

    // 4. Enqueue in sync queue service for background sync-back
    await syncQueueService.enqueue("invoice", invoiceId, "create", {
      ...queuedPayload,
      store_id: resolvedStoreId,
      store_code: resolvedStoreCode,
      invoice_number: assignedDocNumber,
      place_of_supply: posLabel,
      is_offline_temp: false,
      external_id: idempotencyKey,
    });

    return {
      success: true,
      isOnline: false,
      isOfflineQueued: true,
      invoice: invoiceRecord,
    };
  }

  /**
   * Update local SQLite tables from authoritative server response.
   */
  private async syncAuthoritativeInvoiceToLocalCache(
    serverInvoice: any,
    affectedBatches?: Array<{ product_id: any; batch_id: any; batch_no: string; remaining_stock: number }>
  ): Promise<void> {
    const localId = serverInvoice.external_id || `inv_${serverInvoice.id}`;
    const activeStore = storeRegistryService.getActiveStore();
    const storeId = String(serverInvoice.store_id || activeStore?.id || "1");

    // One bill, one row: the server id is the key the register, the drawer and the receipt use, so
    // the authoritative record is written there and the till's own idempotency key is kept as a
    // field instead of being stored a second time under a second primary key. A pending copy of
    // this same document is not a reason to skip — the server has just accepted it.
    const identity = await canonicalizeInvoiceIdentity({
      id: serverInvoice.id,
      external_id: serverInvoice.external_id,
      invoice_number: serverInvoice.invoice_number,
      store_id: storeId,
    });
    const canonicalId = identity.canonicalKey || localId;

    const invRow = {
      ...serverInvoice,
      customer_phone: serverInvoice.customer_phone || serverInvoice.customer?.phone || (serverInvoice as any).phone || "",
      store_id: storeId,
      id: canonicalId,
      external_id: identity.external_id || serverInvoice.external_id || null,
      server_id: serverInvoice.id,
      sync_state: "synced",
      updated_at: Date.now(),
    };
    await sqliteStorage.insertRecord("invoices", canonicalId, invRow);
    await clearInvoiceChildren(canonicalId);

    // Upsert line items in local cache
    if (serverInvoice.items && Array.isArray(serverInvoice.items)) {
      for (let i = 0; i < serverInvoice.items.length; i++) {
        const it = serverInvoice.items[i];
        const itemId = `item_${String(it.id || `${canonicalId}_${i}`)}`;
        await sqliteStorage.insertRecord("invoice_items", itemId, {
          ...it,
          id: itemId,
          invoice_id: canonicalId,
          store_id: storeId,
        });

        // Write stock transaction
        const stockTxId = `srv_stk_${canonicalId}_${i}`;
        const upp = Math.max(1, Number(it.units_per_pack) || 1);
        const qtyDeducted =
          (Number(it.qty || 0) * upp) +
          (Number(it.loose_qty) || 0) +
          (Math.max(0, Number(it.free_qty) || 0) * upp) +
          Math.max(0, Number(it.free_loose_qty) || 0);
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          store_id: storeId,
          product_id: it.product_id,
          batch_id: it.batch_id || it.batch_no || "default",
          event_type: "SALE",
          qty_delta: -qtyDeducted,
          reference_type: "INVOICE",
          reference_id: canonicalId,
          counter_id: serverInvoice.counter_id,
          created_at: Date.now(),
        });

        // Deduct from local batch stock in mock/local SQLite if present
        const bKey = it.batch_id || it.batch_no;
        if (bKey) {
          const locBatch = await sqliteStorage.findById<any>("product_batches", String(bKey));
          if (locBatch) {
            await sqliteStorage.insertRecord("product_batches", String(bKey), {
              ...locBatch,
              stock_qty: (Number(locBatch.stock_qty) || 0) - qtyDeducted,
              updated_at: Date.now(),
            });
          }
        }
      }
    }

    // Upsert payments in local cache
    if (serverInvoice.payments && Array.isArray(serverInvoice.payments)) {
      for (const p of serverInvoice.payments) {
        const payId = String(p.id || `srv_pay_${localId}_${Math.random().toString(16).slice(2, 6)}`);
        await sqliteStorage.insertRecord("invoice_payments", payId, {
          id: payId,
          store_id: storeId,
          invoice_id: localId,
          counter_id: serverInvoice.counter_id,
          counter_code: serverInvoice.counter_code,
          payment_mode: p.payment_mode || p.mode || "Cash",
          amount: Number(p.amount) || 0,
          tendered_amount: Number(p.tendered_amount ?? p.amount ?? 0) || 0,
          change_amount: Number(p.change_amount) || 0,
          reference_no: p.reference_no || null,
          status: p.status || "received",
          extra_fields: typeof p.extra_fields === "object" ? JSON.stringify(p.extra_fields) : p.extra_fields,
          notes: p.notes || null,
          received_by: p.received_by || "Server",
          created_at: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
          updated_at: p.updated_at ? new Date(p.updated_at).getTime() : Date.now(),
        });
      }
    }

    // Update affected batch stock in local cache
    if (affectedBatches && Array.isArray(affectedBatches)) {
      for (const b of affectedBatches) {
        const batchKey = String(b.batch_id);
        const localBatch = await sqliteStorage.findById<any>("product_batches", batchKey);
        if (localBatch) {
          await sqliteStorage.insertRecord("product_batches", batchKey, {
            ...localBatch,
            stock_qty: b.remaining_stock,
            updated_at: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Automatic sync-back triggered upon network reconnection.
   */
  async triggerAutomaticReconnectionSync(): Promise<void> {
    try {
      await syncQueueService.processQueue();
    } catch (err) {
      console.warn("Reconnection sync error", err);
    }
  }
}

export const onlineTransactionService = new OnlineTransactionService();
