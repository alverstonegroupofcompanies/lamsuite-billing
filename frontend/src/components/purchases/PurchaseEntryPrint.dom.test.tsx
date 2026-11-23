import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseEntryForm } from "./PurchaseEntryForm";
import {
  purchaseService,
  type PurchaseItemRecord,
  type PurchaseLineItemInput,
} from "../../lib/purchases/purchaseService";

/**
 * CR-C Task 4.13 / PRN-007 — the voucher a posted purchase bill prints carries its charges.
 *
 * The charge money is already inside the grand total the paper prints, so a preview handed no charge
 * rows is a document that does not add up against its own payable. The print engine's own footing is
 * proven in `src/lib/printing/purchaseChargesPrint.test.ts`; this file owns the screen's half — the
 * payload `PrintPreviewModal` receives when the operator presses the voucher key on a bill that has
 * charges keyed, and on a bill keyed before CR-C whose money sat in the freight scalar.
 */

// The supplier master is not part of this seam; the bill needs one supplier and nothing more.
vi.mock("../../lib/purchases/supplierLedgerService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/purchases/supplierLedgerService")>();
  return {
    ...real,
    supplierLedgerService: {
      ...real.supplierLedgerService,
      getAllSuppliers: async () => [
        { id: "sup_walk", name: "Walkthrough Distributors", is_active: true },
      ],
    },
  };
});

const PACKS: PurchaseLineItemInput = {
  product_id: "prod_1",
  product_name: "Paracetamol 650mg",
  hsn_code: "30049090",
  batch_no: "BATCH-01",
  expiry_date: "2030-12-31",
  pack_qty: 10,
  loose_qty: 0,
  units_per_pack: 1,
  purchase_rate: 100,
  selling_rate: 200,
  discount_type: "percent",
  discount_percent: 0,
  discount_amount: 0,
  gst_percent: 12,
};

const SYRUP: PurchaseLineItemInput = {
  ...PACKS,
  product_id: "prod_2",
  product_name: "Cough Syrup 100ml",
  batch_no: "BATCH-02",
  pack_qty: 4,
  purchase_rate: 50,
  selling_rate: 100,
  gst_percent: 5,
};

const LINES = [PACKS, SYRUP];

// (10 × ₹100 at 12%) + (4 × ₹50 at 5%) = ₹1,330.00 of goods across two lines, so no single line
// total can be mistaken for the payable on the screen.
const GOODS_TOTAL = 1330;

const rupee = (value: number) => `₹ ${value.toFixed(2)}`;

interface PreviewProps {
  docType?: string;
  data?: {
    purchase_number?: string;
    grand_total?: number;
    items?: unknown[];
    charges?: {
      head_code?: string;
      head_name?: string;
      taxable_amount?: number;
      total_tax?: number;
      total_amount?: number;
      paid_separately?: boolean;
      in_payable?: boolean;
    }[];
  };
}

const previewProps = vi.hoisted(() => ({ current: null as unknown as PreviewProps | null }));

// The preview component is 2,200 lines of printer plumbing; what it is handed is the seam here.
vi.mock("../PrintPreviewModal", () => ({
  PrintPreviewModal: (props: PreviewProps) => {
    previewProps.current = props;
    return <div data-print-preview="true" />;
  },
}));

function press(key: string, init: Record<string, unknown> = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
}

async function keyFreightCharge(amount: string) {
  await waitFor(() => expect(document.querySelector('[data-cell="0-head_code"]')).not.toBeNull());
  press("Enter");
  await waitFor(() => expect(document.querySelector('[data-cell-edit="0-amount"]')).not.toBeNull());
  fireEvent.change(document.querySelector<HTMLInputElement>('[data-cell-edit="0-amount"]')!, {
    target: { value: amount },
  });
  press("Enter");
  press("Enter", { ctrlKey: true }); // apply the grid
  await waitFor(() => expect(document.querySelector('[data-cell="0-head_code"]')).toBeNull());
}

async function openChargesGrid() {
  press("f", { altKey: true });
}

async function postBill() {
  press("b", { altKey: true });
  await waitFor(() => expect(document.activeElement?.tagName).toBe("INPUT"));
  fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: "INV-77" } });

  press("F12");
  expect(await screen.findByText(/Post Purchase Inward Bill/)).toBeInTheDocument();
  press("Enter");
}

/** `p` on the post-success modal — the printed voucher, exactly as the operator reaches it. */
async function printVoucher() {
  await screen.findByText("Purchase Bill Posted!");
  press("p");
  await waitFor(() => expect(document.querySelector('[data-print-preview="true"]')).not.toBeNull());
}

async function payable(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

const itemRecords = (): PurchaseItemRecord[] =>
  LINES.map((line, index) =>
    ({
      id: `pbi_${index + 1}`,
      purchase_id: "pb_walk",
      ...line,
      total_units: (line.pack_qty || 0) * (line.units_per_pack || 1),
    }) as unknown as PurchaseItemRecord
  );

function setup(props: Record<string, unknown> = {}) {
  render(
    <PurchaseEntryForm
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      initialPoData={{
        po_id: "",
        supplier_id: "sup_walk",
        supplier_name: "Walkthrough Distributors",
        lines: LINES,
      }}
      {...(props as never)}
    />
  );
}

describe("purchase voucher printing on the entry screen (PRN-007)", () => {
  beforeEach(() => {
    previewProps.current = null;
    vi.restoreAllMocks();
  });

  it("hands the printed voucher the charge row the grid keyed and the payable it foots to", async () => {
    vi.spyOn(purchaseService, "recordInwardPurchaseBill").mockResolvedValue({
      success: true,
      purchaseId: "pb_new",
      purchaseNumber: "PB-9",
      syncState: "synced",
    });

    setup();
    await payable(rupee(GOODS_TOTAL));

    await openChargesGrid();
    await keyFreightCharge("200");
    await payable(rupee(GOODS_TOTAL + 200));

    await postBill();
    await printVoucher();

    const data = previewProps.current!.data!;
    expect(previewProps.current!.docType).toBe("purchase_bill");
    expect(data.grand_total).toBe(GOODS_TOTAL + 200);
    expect(data.charges).toHaveLength(1);
    expect(data.charges![0]).toMatchObject({
      head_code: "FREIGHT",
      taxable_amount: 200,
      total_tax: 0,
      total_amount: 200,
      paid_separately: false,
      in_payable: true,
    });
  });

  it("prints a pre-CR-C bill's freight scalar as the charge row the paper needs", async () => {
    vi.spyOn(purchaseService, "getPurchaseBillById").mockResolvedValue({
      document: {
        id: "pb_walk",
        purchase_number: "PB-0001",
        supplier_id: "sup_walk",
        supplier_name: "Walkthrough Distributors",
        supplier_invoice_no: "INV-1",
        purchase_date: "2026-11-20",
        place_of_supply: "32-Kerala",
        is_interstate: 0,
        subtotal: GOODS_TOTAL,
        tax_total: 120,
        cgst_total: 60,
        sgst_total: 60,
        round_off: 0,
        grand_total: GOODS_TOTAL + 500,
        freight_charges: 500,
        payment_status: "unpaid",
        status: "received",
        sync_state: "pending",
        external_id: "pb_walk",
        created_at: 0,
        updated_at: 0,
      } as never,
      items: itemRecords(),
      charges: [],
    });
    vi.spyOn(purchaseService, "updatePurchaseBill").mockResolvedValue({
      success: true,
      purchaseId: "pb_walk",
      purchaseNumber: "PB-0001",
      syncState: "synced",
    } as never);

    setup({ editPurchaseId: "pb_walk", initialPoData: null });

    // The legacy freight is in the payable the moment the bill opens.
    await payable(rupee(GOODS_TOTAL + 500));

    await openChargesGrid();
    await waitFor(() => expect(document.querySelector('[data-cell="0-head_code"]')).not.toBeNull());
    press("Enter", { ctrlKey: true });
    await waitFor(() => expect(document.querySelector('[data-cell="0-head_code"]')).toBeNull());

    await postBill();
    await printVoucher();

    const data = previewProps.current!.data!;
    expect(data.grand_total).toBe(GOODS_TOTAL + 500);
    expect(data.charges).toHaveLength(1);
    expect(data.charges![0]).toMatchObject({
      head_code: "FREIGHT",
      taxable_amount: 500,
      total_tax: 0,
      total_amount: 500,
      in_payable: true,
    });
  });
});
