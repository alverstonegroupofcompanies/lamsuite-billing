import { describe, it, expect } from "vitest";
import { staffCryptoService } from "./staffCryptoService";

describe("StaffCryptoService", () => {
  it("generates a random salt with requested length", () => {
    const salt1 = staffCryptoService.generateSalt(16);
    const salt2 = staffCryptoService.generateSalt(16);
    expect(salt1).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(salt2).toHaveLength(32);
    expect(salt1).not.toBe(salt2);
  });

  it("hashes password and verifies successfully", async () => {
    const password = "StoreCashier@2026!";
    const hash = await staffCryptoService.hashSecret(password);
    expect(hash).toContain("$pbkdf2-sha256$");

    const isValid = await staffCryptoService.verifySecret(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await staffCryptoService.verifySecret("wrong_password", hash);
    expect(isInvalid).toBe(false);
  });

  it("hashes 4-digit quick PIN and verifies successfully", async () => {
    const pin = "4826";
    const pinHash = await staffCryptoService.hashPin(pin);
    expect(pinHash).toContain("$pbkdf2-sha256$");

    const isValid = await staffCryptoService.verifyPin(pin, pinHash);
    expect(isValid).toBe(true);

    const isInvalid = await staffCryptoService.verifyPin("9999", pinHash);
    expect(isInvalid).toBe(false);
  });

  it("rejects empty or corrupt stored hash", async () => {
    expect(await staffCryptoService.verifySecret("pass", "")).toBe(false);
    expect(await staffCryptoService.verifySecret("pass", "corrupted$hash")).toBe(false);
  });

  it("verifies cloud bcrypt hashes offline (pin and password)", async () => {
    const pinBcrypt = "$2y$10$hTzMsa5MFZkXttfaY0htQeiuj8fWX6Wei0rR0jOO497evXtbTU38S";
    const passwordBcrypt = "$2y$10$eddzfvbKkdbJLhchDI4GOOXY9U32xweVKUbxXyZk0O5B.w1GmCG3a";

    expect(await staffCryptoService.verifyPin("4826", pinBcrypt)).toBe(true);
    expect(await staffCryptoService.verifyPin("9999", pinBcrypt)).toBe(false);
    expect(await staffCryptoService.verifySecret("StoreCashier@2026!", passwordBcrypt)).toBe(true);
    expect(await staffCryptoService.verifySecret("wrong", passwordBcrypt)).toBe(false);
  });

  it("verifies cloud argon2id hashes offline", async () => {
    const argon2Hash =
      "$argon2id$v=19$m=65536,t=4,p=1$OEdieFV4UURTb1laNUt2ZQ$JhXNFvttQamsLT6njcngdxdWZzQWcb1boCTXwijKpgs";

    expect(await staffCryptoService.verifySecret("4826", argon2Hash)).toBe(true);
    expect(await staffCryptoService.verifySecret("9999", argon2Hash)).toBe(false);
  });

  it("classifies slow hash formats", () => {
    expect(staffCryptoService.isSlowHash("$2b$10$abc")).toBe(true);
    expect(staffCryptoService.isSlowHash("$argon2id$v=19$m=1$c2FsdA$aGFzaA")).toBe(true);
    expect(staffCryptoService.isSlowHash("$pbkdf2-sha256$i=1000$s=salt$abc")).toBe(true);
    expect(staffCryptoService.isSlowHash("plaintext-secret")).toBe(false);
  });
});
