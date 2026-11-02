import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";

describe("Clean Branding & Demo Text CI Guardrail (Item 9)", () => {
  it("executes verify-clean-branding script and exits with code 0 without finding forbidden strings", () => {
    const scriptPath = path.resolve(__dirname, "../../../../scripts/verify-clean-branding.cjs");
    const output = execSync(`node "${scriptPath}"`, { encoding: "utf8" });
    expect(output).toContain("Clean branding check passed");
    expect(output).toContain("0 forbidden strings found");
  });
});
