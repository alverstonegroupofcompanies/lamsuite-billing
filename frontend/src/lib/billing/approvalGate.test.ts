import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { posCartService } from "./posCartService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { cashShiftService } from "./cashShiftService";
import { ApprovalRequiredError, requestApprovalGrant } from "./approvalGateService";
import { parseBusinessRuleError } from "../errors/businessRuleError";

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Approval gate (APR-003..010)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();

    await productsStore.upsertProduct({
      id: "prod_para",
      name: "Paracetamol 500mg",
      barcode: "8902222",
      hsn_sac_code: "3004",
      mrp: 30,
      sel_rate: 25,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    });
    await productsStore.upsertBatch({
      id: "batch_p1",
      product_id: "prod_para",
      batch_no: "B-APR-1",
      expiry_date: "2027-06-30",
      stock_qty: 100,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the action keys a deferred save names", () => {
    const payload = parseBusinessRuleError({
      code: "approval_required",
      message: "This bill needs an approver's grant before it can be saved.",
      actions: ["pos.discount", "pos.price_override"],
      reasons: { "pos.discount": "A discount above 10% needs an approver's grant." },
    });

    expect(payload?.code).toBe("approval_required");
    expect(payload?.actions).toEqual(["pos.discount", "pos.price_override"]);
    expect(payload?.reasons).toEqual({ "pos.discount": "A discount above 10% needs an approver's grant." });
  });

  it("exchanges an approver PIN for a grant bound to the bill", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, token: "grant_tok_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const token = await requestApprovalGrant({
      externalId: "ext_bill_1",
      actions: ["pos.discount"],
      mode: "approver_pin",
      identifier: "floor.manager",
      pin: "246810",
      reason: "Damaged pack",
    });

    expect(token).toBe("grant_tok_1");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      document_type: "invoice",
      document_external_id: "ext_bill_1",
      actions: ["pos.discount"],
      mode: "approver_pin",
      identifier: "floor.manager",
      pin: "246810",
      reason: "Damaged pack",
    });
  });

  it("shows the server's refusal when a grant cannot be minted", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: false, code: "INVALID_APPROVER_PIN", error: "Incorrect approver PIN." }, 422)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestApprovalGrant({
        externalId: "ext_bill_1",
        actions: ["pos.discount"],
        mode: "approver_pin",
        identifier: "floor.manager",
        pin: "999999",
      })
    ).rejects.toMatchObject({ code: "INVALID_APPROVER_PIN", message: "Incorrect approver PIN." });
  });

  it("sends the grant with the same bill identity and keeps the deferred actions", async () => {
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue(null);
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      store_id: "1",
      store_code: "STORE-01",
      counter_code: "C01",
    } as never);

    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          code: "approval_required",
          message: "This bill needs an approver's grant before it can be saved.",
          actions: ["pos.discount"],
          reasons: { "pos.discount": "A discount above 10% needs an approver's grant." },
        },
        422
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    onlineTransactionService.setBaseUrl("http://127.0.0.1:8000");
    (onlineTransactionService as unknown as { connectionState: string }).connectionState = "online";

    const result = await onlineTransactionService.submitAuthoritativeInvoice({
      external_id: "ext_bill_1",
      idempotency_key: "ext_bill_1",
      approval_token: "grant_tok_1",
      payment_mode: "Cash",
      grand_total: 100,
      items: [{ product_id: "prod_para", qty: 1, unit_price: 100 }],
    });

    expect(result.success).toBe(false);
    expect(result.businessRule?.code).toBe("approval_required");
    expect(result.businessRule?.actions).toEqual(["pos.discount"]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.approval_token).toBe("grant_tok_1");
    expect(body.external_id).toBe("ext_bill_1");
  });

  it("holds the bill for an approver rather than saving it", async () => {
    await posCartService.scanBarcodeAndAddToCart("8902222");

    vi.spyOn(onlineTransactionService, "submitAuthoritativeInvoice").mockResolvedValue({
      success: false,
      isOnline: true,
      invoice: null,
      error: "This bill needs an approver's grant before it can be saved.",
      businessRule: {
        code: "approval_required",
        rule: null,
        line: null,
        field: null,
        message: "This bill needs an approver's grant before it can be saved.",
        fix: null,
        actions: ["pos.discount"],
        reasons: { "pos.discount": "A discount above 10% needs an approver's grant." },
      },
    });

    let caught: unknown;
    await posCartService
      .finalizeInvoice("INV-APR-1", "Cash", {
        autoClear: false,
        externalId: "ext_held_bill",
      })
      .catch((err) => {
        caught = err;
      });

    expect(caught).toBeInstanceOf(ApprovalRequiredError);
    const approvalError = caught as ApprovalRequiredError;
    expect(approvalError.actions).toEqual(["pos.discount"]);
    expect(approvalError.externalId).toBe("ext_held_bill");
  });

  it("retries the held bill with its grant and the identity the grant names", async () => {
    await posCartService.scanBarcodeAndAddToCart("8902222");

    const submit = vi.spyOn(onlineTransactionService, "submitAuthoritativeInvoice").mockResolvedValue({
      success: true,
      isOnline: true,
      invoice: { id: "42", invoice_number: "INV-APR-2" },
    });
    vi.spyOn(cashShiftService, "recordSaleTenders").mockResolvedValue(undefined as never);

    const result = await posCartService.finalizeInvoice("INV-APR-2", "Cash", {
      autoClear: false,
      externalId: "ext_held_bill",
      approvalToken: "grant_tok_1",
    });

    expect(result.success).toBe(true);

    const payload = submit.mock.calls[0][0];
    expect(payload.external_id).toBe("ext_held_bill");
    expect(payload.idempotency_key).toBe("ext_held_bill");
    expect(payload.approval_token).toBe("grant_tok_1");
  });
});
