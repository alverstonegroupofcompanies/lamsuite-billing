import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { version } from "../../package.json";

/**
 * UI-02 — the footer shows the build's real version.
 *
 * A literal "v2.0" sat in the sidebar while the package (and the shipped
 * 2.1.1 build) said otherwise; the label now reads package.json.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "owner@example.com" },
    hasPermission: () => true,
  }),
}));

describe("Sidebar footer version (UI-02)", () => {
  it("shows the version from package.json", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByText(`v${version}`)).toBeInTheDocument();
    expect(screen.queryByText("v2.0")).not.toBeInTheDocument();
  });
});
