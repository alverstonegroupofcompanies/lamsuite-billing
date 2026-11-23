import { describe, expect, it, vi } from "vitest";
import {
  centralKeyMap,
  findConflicts,
  findScopeOverrides,
  formatChord,
  matchesChord,
  parseChord,
  findShortcut,
  shortcutLabel,
  shortcutsForScope,
  type KeyEventLike,
} from "./centralKeyMap";
import { ShortcutDispatcher } from "./shortcutDispatcher";

const key = (overrides: Partial<KeyEventLike>): KeyEventLike => ({
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("central key map", () => {
  it("has no same-scope shortcut conflicts", () => {
    expect(findConflicts()).toEqual([]);
  });

  it("documents intentional screen overrides of global keys", () => {
    const overrides = findScopeOverrides();
    expect(overrides.map((o) => `${o.chord}:${o.screen.action}`)).toEqual([
      "F1:focusEntry",
      "F3:rateEdit",
      "F1:purchaseFocusEntry",
      "F2:newPurchase",
      "F6:findPurchase",
      "F8:saveDraft",
      "F9:recallDraft",
      "F7:newSalesReturn",
    ]);
    // F12 stopped overriding anything when the till stopped signing people in:
    // there is no global F12 left, so Checkout and Post Purchase simply own it.
    expect(centralKeyMap.filter((s) => s.scope === "global" && s.keys.includes("F12"))).toEqual([]);
    expect(overrides.some((o) => o.screen.action === "focusSupplier" && o.chord === "Alt+S")).toBe(false);
  });

  it("gives the purchase screen its own entry row, new bill and return chords", () => {
    expect(shortcutLabel("purchaseFocusEntry", "purchase")).toBe("F1");
    expect(shortcutLabel("newPurchase", "purchase")).toBe("Ctrl+Shift+N");
    expect(findShortcut("newPurchase", "purchase")?.keys).toContain("F2");
    expect(shortcutLabel("newSalesReturn", "salesReturns")).toBe("F7");
    expect(centralKeyMap.filter((s) => s.scope === "salesReturns")).toHaveLength(1);
  });

  it("exposes exactly the new advertised shortcuts", () => {
    expect(shortcutLabel("holdBill", "pos")).toBe("Alt+H");
    expect(shortcutLabel("recallBill", "pos")).toBe("Alt+L");
    expect(shortcutLabel("batchEdit", "pos")).toBe("Alt+E");
    expect(shortcutLabel("lineDiscount", "pos")).toBe("Alt+I");
    expect(shortcutLabel("switchStore", "global")).toBe("Ctrl+Alt+S");
    expect(shortcutLabel("focusSupplier", "purchase")).toBe("Alt+S");
    expect(shortcutLabel("cancelEdit", "edit")).toBe("Ctrl+Q");
    expect(shortcutLabel("filterPayment", "bills")).toBe("Alt+Shift+P");
    expect(shortcutLabel("focusBillDate", "purchase")).toBe("Alt+D");
    expect(shortcutLabel("toggleCharges", "purchase")).toBe("Alt+F");
    expect(shortcutLabel("toggleDiscountType", "purchase")).toBe("Alt+Y");
    expect(shortcutLabel("quickAddProduct", "purchase")).toBe("Ctrl+N");
  });

  it("exposes the stock adjustment document chords", () => {
    expect(shortcutLabel("newStockAdjustment", "stock")).toBe("Alt+A");
    expect(shortcutLabel("addAdjustmentLine", "stock")).toBe("Insert");
    expect(shortcutLabel("removeAdjustmentLine", "stock")).toBe("Delete");
    expect(shortcutLabel("undoAdjustmentDelete", "stock")).toBe("Ctrl+Z");
    expect(shortcutLabel("toggleAdjustmentMode", "stock")).toBe("Ctrl+M");
    expect(shortcutLabel("importAdjustmentCsv", "stock")).toBe("Ctrl+I");
    expect(shortcutLabel("postStockAdjustment", "stock")).toBe("Ctrl+Enter");
  });

  it("exposes the Alt+F supplier bill charges grid chords", () => {
    expect(shortcutLabel("toggleCharges", "purchase")).toBe("Alt+F");
    expect(shortcutLabel("chargeAddRow", "modal")).toBe("Insert");
    expect(shortcutLabel("chargeDeleteRow", "modal")).toBe("Delete");
    expect(shortcutLabel("chargeUndoDelete", "modal")).toBe("Ctrl+Z");
    expect(shortcutLabel("chargeCycleCell", "modal")).toBe("Space");
    expect(shortcutLabel("chargeEditCell", "modal")).toBe("Enter");
    expect(shortcutLabel("chargeApply", "modal")).toBe("Ctrl+Enter");
    expect(centralKeyMap.filter((s) => s.group === "Charges").every((s) => s.scope === "modal")).toBe(true);
  });

  it("does not expose F8/F9 as POS actions any more", () => {
    const posKeys = shortcutsForScope("pos").flatMap((s) => s.keys);
    expect(posKeys).not.toContain("F8");
    expect(posKeys).not.toContain("F9");
  });

  it("parses modifiers and aliases", () => {
    expect(parseChord("Ctrl+Alt+S")).toMatchObject({ ctrl: true, alt: true, shift: false, key: "s" });
    expect(parseChord("Alt+Left").key).toBe("left");
    expect(parseChord("Ctrl+Bksp").key).toBe("bksp");
    expect(parseChord("Shift+F2")).toMatchObject({ shift: true, key: "f2" });
  });

  it("matches modifier combinations exactly", () => {
    expect(matchesChord(key({ key: "h", altKey: true }), "Alt+H")).toBe(true);
    expect(matchesChord(key({ key: "h" }), "Alt+H")).toBe(false);
    expect(matchesChord(key({ key: "h", altKey: true, ctrlKey: true }), "Alt+H")).toBe(false);
    expect(matchesChord(key({ key: "s", altKey: true, ctrlKey: true }), "Ctrl+Alt+S")).toBe(true);
    expect(matchesChord(key({ key: "P", altKey: true, shiftKey: true }), "Alt+Shift+P")).toBe(true);
    expect(matchesChord(key({ key: "ArrowLeft", altKey: true }), "Alt+Left")).toBe(true);
    expect(matchesChord(key({ key: "F12" }), "F12")).toBe(true);
  });

  it("formats arrows for display", () => {
    expect(formatChord("Alt+Left")).toBe("Alt+←");
    expect(formatChord("Alt+Right")).toBe("Alt+→");
  });

  it("contains no duplicate action ids", () => {
    const actions = centralKeyMap.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("shortcut dispatcher", () => {
  it("lets the screen scope beat the global scope", () => {
    const dispatcher = new ShortcutDispatcher();
    const globalHandler = vi.fn();
    const posHandler = vi.fn();
    dispatcher.register({ id: "global", scope: "global", handlers: { navBills: globalHandler } });
    dispatcher.register({ id: "pos", scope: "pos", handlers: { holdBill: posHandler } });

    expect(dispatcher.dispatch(key({ key: "F6" }))).toBe(true);
    expect(globalHandler).toHaveBeenCalledTimes(1);

    const altH = { ...key({ key: "h", altKey: true }), preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(dispatcher.dispatch(altH)).toBe(true);
    expect(posHandler).toHaveBeenCalledTimes(1);
    expect(altH.preventDefault).toHaveBeenCalled();
  });

  it("honours isActive gates (pharmacy-only keys)", () => {
    const dispatcher = new ShortcutDispatcher();
    const handler = vi.fn();
    dispatcher.register({
      id: "pos",
      scope: "pos",
      isActive: () => false,
      handlers: { focusPatient: handler },
    });
    expect(dispatcher.dispatch(key({ key: "p", altKey: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("falls through when a handler declines the key", () => {
    const dispatcher = new ShortcutDispatcher();
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    dispatcher.register({ id: "screen", scope: "pos", priority: 60, handlers: { holdBill: first } });
    dispatcher.register({ id: "fallback", scope: "pos", priority: 50, handlers: { holdBill: second } });

    expect(dispatcher.dispatch(key({ key: "h", altKey: true }))).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unregisters cleanly", () => {
    const dispatcher = new ShortcutDispatcher();
    const handler = vi.fn();
    const off = dispatcher.register({ id: "pos", scope: "pos", handlers: { holdBill: handler } });
    off();
    expect(dispatcher.dispatch(key({ key: "h", altKey: true }))).toBe(false);
  });

  it("routes every POS billing shortcut to its own handler", () => {
    const dispatcher = new ShortcutDispatcher();
    const handlers = {
      holdBill: vi.fn(() => true),
      recallBill: vi.fn(() => true),
      batchEdit: vi.fn(() => true),
      lineDiscount: vi.fn(() => true),
    };
    dispatcher.register({ id: "pos", scope: "pos", handlers });

    expect(dispatcher.dispatch(key({ key: "h", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "l", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "e", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "i", altKey: true }))).toBe(true);

    expect(handlers.holdBill).toHaveBeenCalledTimes(1);
    expect(handlers.recallBill).toHaveBeenCalledTimes(1);
    expect(handlers.batchEdit).toHaveBeenCalledTimes(1);
    expect(handlers.lineDiscount).toHaveBeenCalledTimes(1);
  });

  it("keeps Alt+S for the supplier on purchase and switch-store on Ctrl+Alt+S", () => {
    const dispatcher = new ShortcutDispatcher();
    const switchStore = vi.fn(() => true);
    const focusSupplier = vi.fn(() => true);
    dispatcher.register({ id: "global", scope: "global", handlers: { switchStore } });
    dispatcher.register({ id: "purchase", scope: "purchase", handlers: { focusSupplier } });

    expect(dispatcher.dispatch(key({ key: "s", altKey: true }))).toBe(true);
    expect(focusSupplier).toHaveBeenCalledTimes(1);
    expect(switchStore).not.toHaveBeenCalled();

    expect(dispatcher.dispatch(key({ key: "s", altKey: true, ctrlKey: true }))).toBe(true);
    expect(switchStore).toHaveBeenCalledTimes(1);
    expect(focusSupplier).toHaveBeenCalledTimes(1);
  });

  it("scopes Alt+D to doctor on POS and bill date on purchase", () => {
    const pos = new ShortcutDispatcher();
    const doctor = vi.fn(() => true);
    const patient = vi.fn(() => true);
    pos.register({ id: "pos", scope: "pos", handlers: { focusDoctor: doctor, focusPatient: patient } });

    expect(pos.dispatch(key({ key: "d", altKey: true }))).toBe(true);
    expect(pos.dispatch(key({ key: "p", altKey: true }))).toBe(true);
    expect(doctor).toHaveBeenCalledTimes(1);
    expect(patient).toHaveBeenCalledTimes(1);

    const purchase = new ShortcutDispatcher();
    const billDate = vi.fn(() => true);
    purchase.register({ id: "purchase", scope: "purchase", handlers: { focusBillDate: billDate } });
    expect(purchase.dispatch(key({ key: "d", altKey: true }))).toBe(true);
    expect(billDate).toHaveBeenCalledTimes(1);
  });

  it("routes Alt+Y to the purchase discount-type toggle only", () => {
    const purchase = new ShortcutDispatcher();
    const purchaseToggle = vi.fn(() => true);
    purchase.register({ id: "purchase", scope: "purchase", handlers: { toggleDiscountType: purchaseToggle } });

    expect(purchase.dispatch(key({ key: "y", altKey: true }))).toBe(true);
    expect(purchaseToggle).toHaveBeenCalledTimes(1);

    expect(purchase.dispatch(key({ key: "y" }))).toBe(false);
    expect(purchaseToggle).toHaveBeenCalledTimes(1);

    const pos = new ShortcutDispatcher();
    const posToggle = vi.fn(() => true);
    pos.register({ id: "pos", scope: "pos", handlers: { toggleDiscountType: posToggle } });
    expect(pos.dispatch(key({ key: "y", altKey: true }))).toBe(false);
    expect(posToggle).not.toHaveBeenCalled();
  });

  it("routes the purchase entry header and post chords", () => {
    const purchase = new ShortcutDispatcher();
    const handlers = {
      focusSupplier: vi.fn(() => true),
      focusBillNo: vi.fn(() => true),
      focusBillDate: vi.fn(() => true),
      toggleCharges: vi.fn(() => true),
      quickAddProduct: vi.fn(() => true),
      postPurchase: vi.fn(() => true),
    };
    purchase.register({ id: "purchase", scope: "purchase", handlers });

    expect(purchase.dispatch(key({ key: "s", altKey: true }))).toBe(true);
    expect(purchase.dispatch(key({ key: "b", altKey: true }))).toBe(true);
    expect(purchase.dispatch(key({ key: "d", altKey: true }))).toBe(true);
    expect(purchase.dispatch(key({ key: "f", altKey: true }))).toBe(true);
    expect(purchase.dispatch(key({ key: "n", ctrlKey: true }))).toBe(true);
    expect(purchase.dispatch(key({ key: "F12" }))).toBe(true);

    expect(handlers.focusSupplier).toHaveBeenCalledTimes(1);
    expect(handlers.focusBillNo).toHaveBeenCalledTimes(1);
    expect(handlers.focusBillDate).toHaveBeenCalledTimes(1);
    expect(handlers.toggleCharges).toHaveBeenCalledTimes(1);
    expect(handlers.quickAddProduct).toHaveBeenCalledTimes(1);
    expect(handlers.postPurchase).toHaveBeenCalledTimes(1);
  });

  it("routes every bills register chord to its own handler", () => {
    const dispatcher = new ShortcutDispatcher();
    const handlers = {
      periodNext: vi.fn(() => true),
      periodPrev: vi.fn(() => true),
      filterPayment: vi.fn(() => true),
      filterStatus: vi.fn(() => true),
    };
    dispatcher.register({ id: "bills-filters", scope: "bills", handlers });

    expect(dispatcher.dispatch(key({ key: "ArrowRight", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "ArrowLeft", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "P", altKey: true, shiftKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "s", altKey: true }))).toBe(true);

    expect(handlers.periodNext).toHaveBeenCalledTimes(1);
    expect(handlers.periodPrev).toHaveBeenCalledTimes(1);
    expect(handlers.filterPayment).toHaveBeenCalledTimes(1);
    expect(handlers.filterStatus).toHaveBeenCalledTimes(1);
  });

  it("routes the stock adjustment document chords to their handlers", () => {
    const dispatcher = new ShortcutDispatcher();
    const handlers = {
      newStockAdjustment: vi.fn(() => true),
      addAdjustmentLine: vi.fn(() => true),
      toggleAdjustmentMode: vi.fn(() => true),
      importAdjustmentCsv: vi.fn(() => true),
      postStockAdjustment: vi.fn(() => true),
      undoAdjustmentDelete: vi.fn(() => true),
    };
    dispatcher.register({ id: "stock", scope: "stock", handlers });

    expect(dispatcher.dispatch(key({ key: "a", altKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "Insert" }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "m", ctrlKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "i", ctrlKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "z", ctrlKey: true }))).toBe(true);

    expect(handlers.newStockAdjustment).toHaveBeenCalledTimes(1);
    expect(handlers.addAdjustmentLine).toHaveBeenCalledTimes(1);
    expect(handlers.toggleAdjustmentMode).toHaveBeenCalledTimes(1);
    expect(handlers.importAdjustmentCsv).toHaveBeenCalledTimes(1);
    expect(handlers.postStockAdjustment).toHaveBeenCalledTimes(1);
    expect(handlers.undoAdjustmentDelete).toHaveBeenCalledTimes(1);
  });

  it("routes the Alt+F charges grid's plain keys only while the grid is open", () => {
    const dispatcher = new ShortcutDispatcher();
    let gridOpen = false;
    const handlers = {
      modalClose: vi.fn(() => true),
      chargeAddRow: vi.fn(() => true),
      chargeMoveUp: vi.fn(() => true),
      chargeCycleCell: vi.fn(() => true),
      chargeEditCell: vi.fn(() => true),
      chargeApply: vi.fn(() => true),
    };
    dispatcher.register({
      id: "purchase-charges",
      scope: "modal",
      isActive: () => gridOpen,
      handlers,
    });

    // Closed: the grid claims nothing, so Enter/Space/arrows reach the screen's own inputs.
    expect(dispatcher.dispatch(key({ key: "Enter" }))).toBe(false);
    expect(dispatcher.dispatch(key({ key: " " }))).toBe(false);
    expect(dispatcher.dispatch(key({ key: "ArrowUp" }))).toBe(false);
    expect(Object.values(handlers).every((h) => h.mock.calls.length === 0)).toBe(true);

    gridOpen = true;
    expect(dispatcher.dispatch(key({ key: "Insert" }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "ArrowUp" }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: " " }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: " ", shiftKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(dispatcher.dispatch(key({ key: "Escape" }))).toBe(true);

    expect(handlers.chargeAddRow).toHaveBeenCalledTimes(1);
    expect(handlers.chargeMoveUp).toHaveBeenCalledTimes(1);
    expect(handlers.chargeCycleCell).toHaveBeenCalledTimes(2);
    expect(handlers.chargeApply).toHaveBeenCalledTimes(1);
    expect(handlers.modalClose).toHaveBeenCalledTimes(1);
    expect(handlers.chargeEditCell).not.toHaveBeenCalled();
  });

  it("lets the charges grid hand a key back while a cell is being typed into", () => {
    const dispatcher = new ShortcutDispatcher();
    const apply = vi.fn(() => true);
    // The grid declines Enter while a number/text cell has the caret, so typing continues.
    const edit = vi.fn(() => false);
    dispatcher.register({
      id: "purchase-charges",
      scope: "modal",
      handlers: { chargeEditCell: edit },
    });
    dispatcher.register({
      id: "purchase-lines",
      scope: "purchase",
      handlers: { postPurchase: apply },
    });

    expect(dispatcher.dispatch(key({ key: "Enter" }))).toBe(false);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    expect(dispatcher.dispatch(key({ key: "Enter", ctrlKey: true }))).toBe(false);
    expect(dispatcher.dispatch(key({ key: "F12" }))).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("routes Ctrl+Q to cancel-edit only for the edit scope", () => {
    const editScope = new ShortcutDispatcher();
    const cancelEdit = vi.fn(() => true);
    editScope.register({ id: "pos-edit", scope: "edit", handlers: { cancelEdit } });
    expect(editScope.dispatch(key({ key: "q", ctrlKey: true }))).toBe(true);
    expect(cancelEdit).toHaveBeenCalledTimes(1);

    const posScope = new ShortcutDispatcher();
    const posCancelEdit = vi.fn(() => true);
    posScope.register({ id: "pos", scope: "pos", handlers: { cancelEdit: posCancelEdit } });
    expect(posScope.dispatch(key({ key: "q", ctrlKey: true }))).toBe(false);
    expect(posCancelEdit).not.toHaveBeenCalled();
  });
});
