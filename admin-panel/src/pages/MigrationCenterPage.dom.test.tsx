import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MigrationCenterPage } from "./MigrationCenterPage";
import { ApiError, api } from "../services/api";

vi.mock("../services/api", async (importActual) => {
  const actual = await importActual<typeof import("../services/api")>();

  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      upload: vi.fn(),
    },
  };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    stores: [
      { id: 7, name: "Alpha Store", code: "STR007" },
      { id: 9, name: "North Branch", code: "STR009" },
    ],
    activeStore: { id: 7, name: "Alpha Store", code: "STR007" },
    setActiveStore: vi.fn(),
    hasPermission: () => true,
  }),
}));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const upload = vi.mocked(api.upload);

const BUNDLE_REF = "11112222-3333-4444-5555-666677778888";

/**
 * MIG-01 in the admin panel.
 *
 * This page used to call the API with no Authorization header, a hardcoded store id of
 * 1, and a `file_path` pointing at whoever's laptop the bundle sat on — which is why an
 * operator could click through a green run and see no data in any branch. Every number
 * shown here now comes from the run the server recorded, and the only source this page
 * can name is a bundle it uploaded itself.
 */
describe("the admin migration hub asks the server", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    upload.mockReset();
    get.mockResolvedValue({ success: true, data: [] });
  });

  it("lists the runs of the branch in scope, through the authenticated client", async () => {
    get.mockResolvedValue({
      success: true,
      data: [
        {
          id: 3,
          run_uuid: "aaaa1111-2222-3333-4444-555566667777",
          store_id: 7,
          source_type: "file",
          source_reference: BUNDLE_REF,
          status: "completed",
          is_dry_run: false,
          cutover_phrase: "CUTOVER-STR007",
          progress_stats: { products: 1284, invoices: 512 },
          reconciliation_report: { is_passed: true },
          created_at: "2026-11-25 10:00:00",
        },
      ],
    });

    render(<MigrationCenterPage />);

    await waitFor(() => expect(get).toHaveBeenCalledWith("/admin/migrations?store_id=7"));
    expect(await screen.findByText("aaaa1111…")).toBeInTheDocument();
    expect(screen.getByText("1284")).toBeInTheDocument();
    expect(screen.getByText("CUTOVER-STR007")).toBeInTheDocument();
  });

  it("names the branch being migrated instead of assuming store 1", async () => {
    render(<MigrationCenterPage />);

    const picker = (await screen.findByLabelText("Branch being migrated")) as HTMLSelectElement;
    expect(picker.value).toBe("7");
    expect(Array.from(picker.options).map((o) => o.textContent)).toContain("#7 — Alpha Store (STR007)");
  });

  it("refuses to scan before a bundle is on the server", async () => {
    render(<MigrationCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Scan & Pre-check/ }));

    await waitFor(() => expect(screen.getByText(/Choose the exported bundle file first/)).toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it("uploads the bundle and starts the run with the reference the upload issued", async () => {
    upload.mockResolvedValue({ success: true, data: { bundle_ref: BUNDLE_REF, entities: { products: 3 } } });
    post.mockResolvedValue({
      success: true,
      data: {
        run: { run_uuid: "bbbb1111", store_id: 7, status: "completed", is_dry_run: false, cutover_phrase: "CUTOVER-STR007" },
        stats: { products: 3 },
        is_dry_run: false,
        reconciliation: { is_passed: true, discrepancies: [] },
        cutover_phrase: "CUTOVER-STR007",
      },
    });

    render(<MigrationCenterPage />);

    fireEvent.change(screen.getByLabelText("Bundle file"), {
      target: { files: [new File(['{"products":[]}'], "bundle.json")] },
    });
    expect(await screen.findByText(new RegExp(BUNDLE_REF.slice(0, 8)))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Execute Live Migration/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/migrations/start", {
        store_id: 7,
        source_type: "file",
        config: { bundle_ref: BUNDLE_REF },
        is_dry_run: false,
      })
    );
    expect(upload).toHaveBeenCalledWith("/admin/migrations/bundle", expect.any(FormData));
    expect(await screen.findByText(/Reconciliation passed/)).toBeInTheDocument();
  });

  it("reports the server's pre-check counts rather than a number it computed", async () => {
    upload.mockResolvedValue({ success: true, data: { bundle_ref: BUNDLE_REF, entities: { products: 3 } } });
    post.mockResolvedValue({
      success: true,
      data: {
        can_proceed: true,
        record_counts: { products: 1, invoices: 1 },
        issues: [{ type: "warning", category: "quality", message: "A batch expires in 30 days." }],
        summary: { total_records: 8, warnings_count: 1, errors_count: 0 },
      },
    });

    render(<MigrationCenterPage />);

    fireEvent.change(screen.getByLabelText("Bundle file"), {
      target: { files: [new File(['{"products":[]}'], "bundle.json")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Scan & Pre-check/ }));

    expect(await screen.findByText(/Pre-check: 8 records found/)).toBeInTheDocument();
    expect(screen.getByText("Cleared to migrate")).toBeInTheDocument();
    expect(screen.getByText(/A batch expires in 30 days/)).toBeInTheDocument();
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/migrations/precheck", {
        store_id: 7,
        source_type: "file",
        config: { bundle_ref: BUNDLE_REF },
      })
    );
  });

  it("points at the switch when the branch has migration closed", async () => {
    upload.mockResolvedValue({ success: true, data: { bundle_ref: BUNDLE_REF, entities: { products: 3 } } });
    post.mockRejectedValue(
      new ApiError("Data migration is switched off for Alpha Store.", 403, { code: "data_migration_disabled" })
    );

    render(<MigrationCenterPage />);

    fireEvent.change(screen.getByLabelText("Bundle file"), {
      target: { files: [new File(['{"products":[]}'], "bundle.json")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Run Dry-Run Simulation/ }));

    expect(await screen.findByText(/Menu & Feature Control/)).toBeInTheDocument();
  });
});
