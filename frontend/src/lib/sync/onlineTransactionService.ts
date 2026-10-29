import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";
import { counterSequenceService, type DocType } from "../auth/counterSequenceService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { staffAuthService } from "../auth/staffAuthService";
import { syncQueueService } from "./syncQueueService";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import type { PaymentTenderLine } from "../billing/billingTenderService";

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
  bill_discount_percent?: number;
  bill_discount_amount?: number;
  manual_round_off?: number | null;
  subtotal?: number;
  discount_total?: number;
  tax_total?: number;
  round_off?: number;
  grand_total?: number;
  is_inter_state?: boolean;
  is_offline_temp?: boolean;
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
}

export class OnlineTransactionService {
  private connectionState: ConnectionState = "online";
  private lastLatencyMs = 45;
  private lastOnlineTimestamp = Date.now();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(health: NetworkHealth) => void>();
  private activeBaseUrl?: string;

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

    const urlsToTry = [this.getEffectiveBaseUrl()];
    const hubIp = localStorage.getItem("lamsuite_hub_ip");
    const hubPort = localStorage.getItem("lamsuite_hub_port") || "8000";
    if (hubIp && !urlsToTry.includes(`http://${hubIp}:${hubPort}`)) {
      urlsToTry.push(`http://${hubIp}:${hubPort}`);
    }

    for (const url of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(`${url}/api/lan/v1/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        latency = Date.now() - start;
        if (res.ok) {
          isConnected = true;
          if (url !== this.getEffectiveBaseUrl()) {
            this.activeBaseUrl = url;
          }
          break;
        }
      } catch {
        // try next
      }
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
   * Check status of counter's pre-leased number series block and auto-replenish if online and low (< 20%).
   */
  async checkLeaseBlockStatus(docType: DocType = "invoice"): Promise<{ remaining: number; isLow: boolean }> {
    try {
      const profile = await storeDeviceService.getDeviceProfile();
      const counterId = profile?.counter_code || "C01";
      const fy = counterSequenceService.getCurrentFinancialYear();
      const seqId = `${counterId}_${docType}_${fy}`;

      const seq = await sqliteStorage.findById<any>("counter_sequences", seqId);
      if (!seq || !seq.range_end) {
        return { remaining: 50, isLow: false };
      }

      const remaining = Math.max(0, seq.range_end - seq.next_number + 1);
      const isLow = remaining < 10;

      // Proactive replenishment when online
      if (isLow && this.connectionState !== "offline") {
        this.replenishLeasedBlock(counterId, docType).catch(() => {});
      }

      return { remaining, isLow };
    } catch {
      return { remaining: 50, isLow: false };
    }
  }

  /**
   * Request a new reserved block of numbers from cloud backend.
   */
  async replenishLeasedBlock(counterCode: string, docType: DocType = "invoice", blockSize = 50): Promise<boolean> {
    try {
      const activeStore = storeRegistryService.getActiveStore();
      const profile = await storeDeviceService.getDeviceProfile();
      const storeId = String(activeStore?.id || profile?.store_id || "1");

      const res = await fetch(`${this.getEffectiveBaseUrl()}/api/counters/${counterCode}/lease-sequence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Store-Id": storeId,
          "Store-Id": storeId,
        },
        body: JSON.stringify({
          doc_type: docType,
          allocate_block: true,
          block_size: blockSize,
        }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.success && data.leased_block) {
        const b = data.leased_block;
        const fy = b.financial_year || counterSequenceService.getCurrentFinancialYear();
        const seqId = `${counterCode}_${docType}_${fy}`;

        await sqliteStorage.insertRecord("counter_sequences", seqId, {
          id: seqId,
          counter_id: counterCode,
          doc_type: docType,
          financial_year: fy,
          prefix: b.prefix,
          next_number: b.range_start,
          range_start: b.range_start,
          range_end: b.range_end,
          updated_at: Date.now(),
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Primary Online Transaction Execution:
   * Submits to Cloud Backend API first. On success, updates local SQLite cache.
   * On network timeout or connection failure, seamlessly degrades to offline fallback.
   */
  async submitAuthoritativeInvoice(payload: OnlineInvoicePayload): Promise<AuthoritativeInvoiceResponse> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = storeRegistryService.getActiveStore();
    const session = staffAuthService.getCurrentSession();
    const resolvedStoreId = String(payload.store_id || activeStore?.id || session?.user?.store_id || profile?.store_id || "1");
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
          // Business rule violation (period lock, credit limit, out of stock)
          return {
            success: false,
            isOnline: true,
            invoice: null,
            error: data.error || "Transaction rejected by business rules.",
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
   * 1. Obtains number from pre-leased block or emergency temp series
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
    const session = staffAuthService.getCurrentSession();
    const resolvedStoreId = String(payload.store_id || activeStore?.id || session?.user?.store_id || profile?.store_id || "1");
    const resolvedStoreCode = String(payload.store_code || activeStore?.code || profile?.store_code || "STORE-01");
    const counterId = profile?.counter_code || counterCode || "C01";

    let assignedDocNumber = payload.invoice_number || "";
    let isTempNumber = false;

    if (!assignedDocNumber) {
      try {
        assignedDocNumber = await counterSequenceService.getNextDocumentNumber(counterId, counterCode, "invoice");
      } catch {
        // Leased block exhausted while offline: Fall back to emergency temporary series!
        const emergencySeq = Math.floor(Math.random() * 9000) + 1000;
        assignedDocNumber = `TEMP-${counterCode}-${Date.now().toString().slice(-4)}${emergencySeq}`;
        isTempNumber = true;
      }
    }

    const now = Date.now();
    const invoiceId = `offline_inv_${now}_${Math.random().toString(16).slice(2, 6)}`;

    // Authoritative calculation via tax engine
    const docTaxes = calculateDocumentTaxes({
      store_state: "32",
      customer_gstin: payload.customer_gstin,
      place_of_supply: payload.place_of_supply || (payload.is_inter_state ? "XX" : "32"),
      default_tax_mode: "inclusive",
      lines: payload.items.map((item, idx) => ({
        line_id: `L${idx}`,
        product_id: item.product_id,
        product_name: item.product_name,
        qty: Number(item.qty || 1),
        loose_qty: Number(item.loose_qty || 0),
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

    const paymentLines = payload.payments && payload.payments.length > 0
      ? payload.payments
      : [{ mode: payload.payment_mode || "Cash", amount: payload.paid_amount ?? finalGrandTotal }];

    let creditPortion = 0;
    let totalPaid = 0;
    for (const p of paymentLines) {
      const upper = (p.mode || "").trim().toUpperCase();
      if (upper === "CREDIT" || upper === "UDHARI") {
        creditPortion += Number(p.amount) || 0;
      } else {
        totalPaid += Number(p.amount) || 0;
      }
    }
    const primaryMode = paymentLines.length > 1 ? "Split" : (paymentLines[0]?.mode || "Cash");
    let paymentStatus = "paid";
    if (creditPortion >= finalGrandTotal - 0.01) {
      paymentStatus = "unpaid";
    } else if (creditPortion > 0.001 || totalPaid < finalGrandTotal - 0.01) {
      paymentStatus = "partially_paid";
    }

    // Build local invoice record
    const invoiceRecord = {
      id: invoiceId,
      store_id: resolvedStoreId,
      store_code: resolvedStoreCode,
      module_key: "invoice",
      invoice_number: assignedDocNumber,
      invoice_date: payload.invoice_date || new Date().toISOString().slice(0, 10),
      customer_id: payload.customer_id || "",
      customer_name: payload.customer_name || "Walk-in Customer",
      customer_phone: payload.customer_phone || "",
      customer_gstin: payload.customer_gstin || "",
      place_of_supply: payload.place_of_supply || "32-Kerala",
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
      external_id: idempotencyKey,
      is_offline: true,
      is_offline_temp: isTempNumber,
      sync_state: "pending",
      created_at: now,
      updated_at: now,
      items: lineRecords,
    };

    // 1. Write to Durable Write-Ahead Queue (WAL) on disk/SQLite to survive crashes
    await sqliteStorage.insertRecord("offline_durable_queue", idempotencyKey, {
      id: idempotencyKey,
      store_id: resolvedStoreId,
      entity_type: "invoice",
      document_number: assignedDocNumber,
      payload_json: JSON.stringify({
        ...payload,
        store_id: resolvedStoreId,
        store_code: resolvedStoreCode,
        invoice_number: assignedDocNumber,
        is_offline_temp: isTempNumber,
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
      const qtyDeducted = (Number(item.qty || 1) * (item.units_per_pack || 1)) + (Number(item.loose_qty) || 0);

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
      ...payload,
      store_id: resolvedStoreId,
      store_code: resolvedStoreCode,
      invoice_number: assignedDocNumber,
      is_offline_temp: isTempNumber,
      external_id: idempotencyKey,
    });

    return {
      success: true,
      isOnline: false,
      isOfflineQueued: true,
      isTempNumber,
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

    // Upsert invoice in local cache under both localId and server numeric ID
    const invRow = {
      ...serverInvoice,
      store_id: storeId,
      id: localId,
      server_id: serverInvoice.id,
      sync_state: "synced",
      updated_at: Date.now(),
    };
    await sqliteStorage.insertRecord("invoices", localId, invRow);
    const serverIdStr = String(serverInvoice.id);
    if (serverIdStr && serverIdStr !== localId) {
      await sqliteStorage.insertRecord("invoices", serverIdStr, {
        ...invRow,
        id: serverIdStr,
      });
    }

    // Upsert line items in local cache
    if (serverInvoice.items && Array.isArray(serverInvoice.items)) {
      for (let i = 0; i < serverInvoice.items.length; i++) {
        const it = serverInvoice.items[i];
        const itemId = String(it.id || `srv_item_${localId}_${i}`);
        await sqliteStorage.insertRecord("invoice_items", itemId, {
          ...it,
          id: itemId,
          invoice_id: localId,
          store_id: storeId,
        });

        // Write stock transaction
        const stockTxId = `srv_stk_${localId}_${i}`;
        const qtyDeducted = Number(it.qty || 1);
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          store_id: storeId,
          product_id: it.product_id,
          batch_id: it.batch_id || it.batch_no || "default",
          event_type: "SALE",
          qty_delta: -qtyDeducted,
          reference_type: "INVOICE",
          reference_id: localId,
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
