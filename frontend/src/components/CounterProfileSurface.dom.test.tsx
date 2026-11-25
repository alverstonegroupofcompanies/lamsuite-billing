import React, { useEffect, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AccessGate } from "./AccessGate";
import { TopNav } from "./TopNav";
import { counterSessionService, type CounterContextPayload } from "../lib/auth/counterSessionService";
import { I18nProvider } from "../lib/i18n/I18nContext";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";
import { resetOfflineStaffVaultKeyCache } from "../lib/auth/offlineStaffVault";

/**
 * PRF-001 / SEC-001 at the till — the counter's document is the surface.
 *
 * Nothing signs a person in to choose what this machine may open: the screens
 * come from the permission document the store owner saved for this counter. A
 * module left out of the document is not offered in the navigation and its
 * route refuses, naming who can change it. A till holding no document defers to
 * the store's own menu ceiling rather than guessing what the owner meant.
 */

const ALL_MENUS = [
  "dashboard",
  "pos",
  "bills",
  "sales_returns",
  "customer_debit_notes",
  "purchases",
  "purchase_returns",
  "stock",
  "stock_transfers",
  "reports",
  "masters",
  "import_export",
  "migration",
  "settings",
  "counters",
];

function context(modules: string[] | null): CounterContextPayload {
  return {
    counter: { id: 12, counter_code: "C01", counter_name: "Front Counter" },
    store: { id: 7 },
    profile: modules === null ? null : { permissions: { modules }, version: 1 },
  } as unknown as CounterContextPayload;
}

function renderGate(menu: string, children = <div>the screen is open</div>) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AccessGate menu={menu}>{children}</AccessGate>
    </MemoryRouter>
  );
}

function renderNav(menus: string[] = ALL_MENUS) {
  return render(
    <MemoryRouter initialEntries={["/pos"]}>
      <I18nProvider>
        <TopNav enabledMenus={menus} onOpenShortcutsHelp={() => {}} />
      </I18nProvider>
    </MemoryRouter>
  );
}

/** Re-renders when the document changes, the way the routed till does. */
const LiveGate: React.FC<{ menu: string }> = ({ menu }) => {
  const [, setTick] = useState(0);
  useEffect(() => counterSessionService.subscribe(() => setTick((n) => n + 1)), []);

  return <AccessGate menu={menu}>{<div>the screen is open</div>}</AccessGate>;
};

describe("The counter document decides what the till opens (PRF-001)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    resetOfflineStaffVaultKeyCache();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();

    counterSessionService.unload();
    await counterSessionService.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refuses a screen the document left out and names who can change it", async () => {
    await counterSessionService.applyContext(context(["dashboard", "pos", "bills"]));

    renderGate("purchases");

    expect(screen.queryByText(/the screen is open/i)).toBeNull();
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/this counter/i)).toBeInTheDocument();
    expect(screen.getByText(/counters/i)).toBeInTheDocument();
  });

  it("lets through every screen the document grants", async () => {
    await counterSessionService.applyContext(context(["dashboard", "pos", "bills"]));

    renderGate("pos", <div>the till bills</div>);
    expect(screen.getByText(/the till bills/i)).toBeInTheDocument();
  });

  it("a till with no document yet defers to the store ceiling", () => {
    renderGate("purchases", <div>the till buys</div>);
    expect(screen.getByText(/the till buys/i)).toBeInTheDocument();
  });

  it("takes the owner's narrowing the moment the document changes", async () => {
    await counterSessionService.applyContext(context(ALL_MENUS));
    render(<LiveGate menu="masters" />);
    expect(screen.getByText(/the screen is open/i)).toBeInTheDocument();

    await counterSessionService.applyContext(context(["dashboard", "pos"]));

    await waitFor(() => expect(screen.getByText(/access restricted/i)).toBeInTheDocument());
    expect(screen.queryByText(/the screen is open/i)).toBeNull();
  });

  it("offers in the navigation only the modules the document grants", async () => {
    await counterSessionService.applyContext(context(["dashboard", "pos", "bills", "reports"]));

    renderNav();

    expect(screen.getByText("POS Billing")).toBeInTheDocument();
    expect(screen.queryByText("Inward Purchases")).toBeNull();
    expect(screen.queryByText("Masters")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("with no document the navigation shows the store's own menus", () => {
    renderNav();

    expect(screen.getByText("POS Billing")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
