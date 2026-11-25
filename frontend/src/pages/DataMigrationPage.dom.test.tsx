import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DataMigrationPage } from "./DataMigrationPage";
import { TopNav } from "../components/TopNav";
import { I18nProvider } from "../lib/i18n/I18nContext";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { MigrationRequestError, tillMigrationService } from "../lib/migration/tillMigrationService";

vi.mock("../lib/migration/tillMigrationService", async (importActual) => {
  const actual = await importActual<typeof import("../lib/migration/tillMigrationService")>();

  return {
    ...actual,
    tillMigrationService: {
      list: vi.fn().mockResolvedValue([]),
      precheck: vi.fn(),
      start: vi.fn(),
      cutover: vi.fn(),
      rollback: vi.fn(),
      uploadBundle: vi.fn(),
    },
  };
});

const list = vi.mocked(tillMigrationService.list);
const precheck = vi.mocked(tillMigrationService.precheck);

const scanButton = () => screen.getByRole("button", { name: /Scan & Pre-check Quality/ });

function renderNav(enabledMenus: string[]) {
  return render(
    <MemoryRouter initialEntries={["/pos"]}>
      <I18nProvider>
        <TopNav enabledMenus={enabledMenus} onOpenShortcutsHelp={() => {}} />
      </I18nProvider>
    </MemoryRouter>
  );
}

/**
 * The wizard used to be a simulation: it opened on the portal host, treated the token
 * as optional, and reported success whatever the server said — while writing only into
 * this workstation's SQLite copy. It now delegates every step, so these tests hold the
 * screen to what the server answered, including when the answer is "not allowed here".
 */
describe("the migration wizard reports the server, not itself", () => {
  beforeEach(() => {
    list.mockResolvedValue([]);
    precheck.mockReset();
  });

  it("opens on the legacy panel host, not the portal", () => {
    render(<DataMigrationPage />);

    const url = screen.getByDisplayValue("https://admin.lamstonehealthcare.com") as HTMLInputElement;
    expect(url.value).not.toMatch(/^https:\/\/(app|web|api)\./);
    expect(screen.getByText(/admin\/migration-token/)).toBeInTheDocument();
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
  });

  it("refuses to scan without a token instead of asking the server", async () => {
    render(<DataMigrationPage />);

    fireEvent.click(scanButton());

    await waitFor(() => expect(precheck).not.toHaveBeenCalled());
    expect(await screen.findByText(/legacy pull needs a token/i)).toBeInTheDocument();
  });

  it("shows the branch's own switch when the server refuses to migrate", async () => {
    precheck.mockRejectedValue(
      new MigrationRequestError("Data migration is switched off for Alpha Store.", 403, "data_migration_disabled")
    );

    render(<DataMigrationPage />);
    fireEvent.change(screen.getByPlaceholderText("Sanctum token"), { target: { value: "legacy-token" } });
    fireEvent.click(scanButton());

    expect(await screen.findByText(/Menu & Feature Control/)).toBeInTheDocument();
    expect(screen.getByText(/switched off for Alpha Store/)).toBeInTheDocument();
  });

  it("lists the runs the server recorded, with the counts it wrote", async () => {
    list.mockResolvedValue([
      {
        id: 5,
        run_uuid: "aaaa1111-2222-3333-4444-555566667777",
        store_id: 7,
        source_type: "file",
        source_reference: "ref-1",
        status: "completed",
        is_dry_run: false,
        created_at: "2026-11-25 10:00:00",
        progress_stats: { products: 1284, invoices: 512 },
        reconciliation_report: { id: 9, is_passed: true },
        cutover_phrase: "CUTOVER-STR001",
      },
    ]);

    render(<DataMigrationPage />);

    expect(await screen.findByText("aaaa1111…")).toBeInTheDocument();
    expect(screen.getByText("1284")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.queryByText(/No migration run has been recorded/)).not.toBeInTheDocument();
  });
});

/**
 * MIG-02 at the till: the switch the owner flipped in Menu & Feature Control arrives
 * with the rest of the store configuration, and the wizard stops offering itself when
 * it says off — the server refuses the same calls, but a tab that only 403s is a trap.
 */
describe("the store's Data Migration switch decides what the till offers", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  afterEach(async () => {
    await companySettingsService.updateLocalFromRemote({ feature_flags: { allow_data_migration: true } });
  });

  it("closes the wizard when the branch switched data migration off", async () => {
    await companySettingsService.updateLocalFromRemote({ feature_flags: { allow_data_migration: false } });

    render(<DataMigrationPage />);

    expect(await screen.findByText(/switched off for this branch/i)).toBeInTheDocument();
    expect(screen.getByText(/Menu & Feature Control/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scan & Pre-check Quality/ })).toBeNull();
  });

  it("keeps the wizard open while the switch is on", async () => {
    await companySettingsService.updateLocalFromRemote({ feature_flags: { allow_data_migration: true } });

    render(<DataMigrationPage />);

    expect(scanButton()).toBeInTheDocument();
  });

  it("only shows the tab while the store's menu list carries it", () => {
    renderNav(["pos", "bills", "migration"]);
    expect(screen.getByText("Data Migration")).toBeInTheDocument();
  });

  it("drops the tab from the navigation once the store's list no longer carries it", async () => {
    await companySettingsService.updateLocalFromRemote({ feature_flags: { allow_data_migration: false } });

    renderNav(["pos", "bills"]);

    expect(screen.queryByText("Data Migration")).toBeNull();
  });
});
