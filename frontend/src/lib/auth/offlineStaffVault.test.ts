import { describe, it, expect, beforeEach } from "vitest";
import { resetMockHandlers } from "../ipc/ipcBridge";
import {
  decryptStaffSecret,
  encryptStaffSecret,
  isEncryptedStaffSecret,
  resetOfflineStaffVaultKeyCache,
} from "./offlineStaffVault";

describe("offline staff vault", () => {
  beforeEach(() => {
    localStorage.clear();
    resetOfflineStaffVaultKeyCache();
  });

  it("encrypts hashes at rest and decrypts them back", async () => {
    const hash = "$2y$10$hTzMsa5MFZkXttfaY0htQeiuj8fWX6Wei0rR0jOO497evXtbTU38S";
    const encrypted = await encryptStaffSecret(hash);

    expect(isEncryptedStaffSecret(encrypted)).toBe(true);
    expect(encrypted.startsWith("vault:v1:")).toBe(true);
    expect(encrypted).not.toContain(hash);
    expect(await decryptStaffSecret(encrypted)).toBe(hash);
  });

  it("is deterministic for storage but uses a fresh IV per write", async () => {
    const hash = "$pbkdf2-sha256$i=50000$s=abcdef$0123456789abcdef";
    const first = await encryptStaffSecret(hash);
    const second = await encryptStaffSecret(hash);

    expect(first).not.toBe(second);
    expect(await decryptStaffSecret(first)).toBe(hash);
    expect(await decryptStaffSecret(second)).toBe(hash);
  });

  it("returns legacy plaintext hashes unchanged", async () => {
    const hash = "$2b$10$legacyvalue";
    expect(await decryptStaffSecret(hash)).toBe(hash);
  });

  it("fails closed when the ciphertext cannot be decrypted with the device key", async () => {
    const encrypted = await encryptStaffSecret("$2b$10$cachedhash");
    expect(encrypted.startsWith("vault:v1:")).toBe(true);
    // Simulate a database copied to another workstation with a different key.
    resetOfflineStaffVaultKeyCache();
    resetMockHandlers();
    localStorage.clear();
    expect(localStorage.getItem("lamsuite_offline_staff_vault_key")).toBe(null);

    expect(await decryptStaffSecret(encrypted)).toBe("");
  });

  it("does not double-wrap already encrypted values", async () => {
    const encrypted = await encryptStaffSecret("$2b$10$value");
    expect(await encryptStaffSecret(encrypted)).toBe(encrypted);
  });
});
