import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataMigrationPage } from "./DataMigrationPage";

/**
 * The wizard opened on the portal host and called the token optional. Both were wrong:
 * the portal has no /api/sync/pull, and the legacy endpoint answers 401 without a token.
 * An operator with a freshly minted token got "Could not connect … Load failed" and had
 * no way to tell that the URL above the field was the problem.
 */
describe("the migration wizard's source setup tells the truth", () => {
  it("opens on the legacy panel host, not the portal", () => {
    render(<DataMigrationPage />);

    const url = screen.getByPlaceholderText("https://admin.lamstonehealthcare.com") as HTMLInputElement;
    expect(url).toHaveValue("https://admin.lamstonehealthcare.com");
    expect(url.value).not.toMatch(/^https:\/\/(app|web|api)\./);
  });

  it("asks for the token and says where it comes from", () => {
    render(<DataMigrationPage />);

    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
    expect(screen.getByText(/admin\/migration-token/)).toBeInTheDocument();
  });
});
