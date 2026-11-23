import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginPage } from "./LoginPage";

/**
 * UI-02 — the email field suggests a format, not a specific tenant account.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

describe("LoginPage email placeholder (UI-02)", () => {
  it("uses a neutral placeholder instead of a brand address", () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText("you@company.com")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/alverstone/i)).not.toBeInTheDocument();
  });
});
