import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseEntryForm } from "./PurchaseEntryForm";
import { purchaseDraftService } from "../../lib/purchases/purchaseDraftService";
import type { PurchaseLineItemInput } from "../../lib/purchases/purchaseService";
import { shortcutDispatcher } from "../../lib/keyboard/shortcutDispatcher";
import { requestKeyboardNavigation } from "../../lib/keyboard/navigationGuard";

/**
 * KB-02: an open purchase bill owns its keyboard.
 *
 * The global shell answers F1/F6/F8/F9/F2 on every screen in the capture phase. Before this
 * screen registered itself, those chords left the bill — F1 walked to POS, F9 to Import/Export,
 * F2 re-navigated — and the unsaved lines went with the screen. Every step here is a key an
 * operator presses in a live bill; no pointer event is fired.
 */

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

const LINES: PurchaseLineItemInput[] = [
  {
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
  },
];

const rupees = (value: number) => `₹ ${value.toFixed(2)}`;

function press(key: string, init: Record<string, unknown> = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
}

let globalHandlers: Record<string, ReturnType<typeof vi.fn>>;
let unregisterGlobal: () => void;
let uninstall: () => void;

/** The global shell as Layout installs it, reduced to the chords this defect names. */
function installGlobalShell() {
  globalHandlers = {
    navPos: vi.fn(() => true),
    navPurchases: vi.fn(() => true),
    navBills: vi.fn(() => true),
    navCounters: vi.fn(() => true),
    navImportExport: vi.fn(() => true),
    navStock: vi.fn(() => {
      if (requestKeyboardNavigation("/stock")) globalHandlers.stockNavigated();
      return true;
    }),
    stockNavigated: vi.fn(),
  };

  uninstall = shortcutDispatcher.install();
  unregisterGlobal = shortcutDispatcher.register({
    id: "test-global-shell",
    scope: "global",
    handlers: {
      navPos: globalHandlers.navPos,
      navPurchases: globalHandlers.navPurchases,
      navBills: globalHandlers.navBills,
      navCounters: globalHandlers.navCounters,
      navImportExport: globalHandlers.navImportExport,
      navStock: globalHandlers.navStock,
    },
  });
}

function setup(props: Partial<ComponentProps<typeof PurchaseEntryForm>> = {}) {
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
      {...props}
    />
  );
}

const entryRow = () =>
  screen.getByPlaceholderText(/Scan barcode or type product name/i) as HTMLInputElement;

async function loadedBill() {
  await waitFor(() => expect(screen.getAllByText(rupees(1120)).length).toBeGreaterThan(0));
}

describe("Purchase bill owns F1, F2, F6, F8 and F9 while it is open (KB-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installGlobalShell();
  });

  afterEach(() => {
    unregisterGlobal();
    uninstall();
  });

  it("keeps F1 on the bill's entry row instead of walking to POS", async () => {
    setup();
    await loadedBill();

    press("F1");

    await waitFor(() => expect(document.activeElement).toBe(entryRow()));
    expect(globalHandlers.navPos).not.toHaveBeenCalled();
  });

  it("opens the saved drafts on F9 instead of Import / Export", async () => {
    vi.spyOn(purchaseDraftService, "getAllDrafts").mockResolvedValue([]);

    setup();
    await loadedBill();

    press("F9");

    expect(await screen.findByText("Saved Purchase Drafts")).toBeInTheDocument();
    expect(globalHandlers.navImportExport).not.toHaveBeenCalled();
  });

  it("holds the bill as a draft on F8 instead of opening Store Counters", async () => {
    const saveDraft = vi
      .spyOn(purchaseDraftService, "saveDraft")
      .mockResolvedValue(undefined as never);

    setup();
    await loadedBill();

    press("F8");

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(globalHandlers.navCounters).not.toHaveBeenCalled();
  });

  it("closes to the list on F6, asking first when the bill holds lines", async () => {
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    setup({ onClose });
    await loadedBill();

    press("F6");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(globalHandlers.navBills).not.toHaveBeenCalled();
  });

  it("starts a new bill on F2 after the discard guard, never a silent reset", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    setup();
    await loadedBill();

    press("F2");

    // Refused: the lines stay exactly where they were.
    expect(confirmSpy).toHaveBeenCalled();
    expect(globalHandlers.navPurchases).not.toHaveBeenCalled();
    expect(screen.getByText("Paracetamol 650mg")).toBeInTheDocument();
  });

  it("asks the bill before a global navigation chord can leave it", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    setup();
    await loadedBill();

    press("F3");

    expect(confirmSpy).toHaveBeenCalled();
    expect(globalHandlers.stockNavigated).not.toHaveBeenCalled();
  });
});
