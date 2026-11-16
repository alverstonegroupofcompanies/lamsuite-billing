/**
 * Device-bound at-rest protection for the offline staff credential directory.
 *
 * The cached bcrypt/Argon2/PBKDF2 hashes are encrypted with AES-GCM using a
 * random 256-bit key that lives in the OS keychain (Tauri secure store). Copying
 * the local database to another workstation therefore yields unusable hashes.
 * Legacy plaintext hashes remain readable and are re-encrypted on the next write.
 */

import { invokeCommand } from "../ipc/ipcBridge";

const SECURE_STORE_KEY = "offline_staff_vault_key";
const LOCAL_STORAGE_KEY = "lamsuite_offline_staff_vault_key";
const ENCRYPTED_PREFIX = "vault:v1:";
const PLAINTEXT_FALLBACK_PREFIX = "vault:plain:";

let cachedKeyBytes: Uint8Array | null = null;
let cachedAesKey: CryptoKey | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function hasWebCrypto(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof crypto.getRandomValues === "function";
}

async function readStoredKey(): Promise<Uint8Array | null> {
  try {
    const stored = await invokeCommand<string | null>("secure_store_get", { key: SECURE_STORE_KEY });
    if (stored) return fromBase64(stored);
  } catch {
    // Mock/web runtime: fall through to the local profile key
  }
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) return fromBase64(stored);
  } catch {
    // Storage unavailable
  }
  return null;
}

async function persistKey(keyBytes: Uint8Array): Promise<void> {
  const encoded = toBase64(keyBytes);
  let stored = false;
  try {
    await invokeCommand("secure_store_set", { key: SECURE_STORE_KEY, value: encoded });
    stored = true;
  } catch {
    // Mock/web runtime
  }
  if (!stored) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, encoded);
    } catch {
      // Storage unavailable; key stays in memory for this session
    }
  }
}

async function getKeyMaterial(): Promise<{ keyBytes: Uint8Array; aesKey: CryptoKey | null }> {
  if (!cachedKeyBytes) {
    cachedKeyBytes = (await readStoredKey()) || randomBytes(32);
    if (cachedKeyBytes.length !== 32) cachedKeyBytes = randomBytes(32);
    await persistKey(cachedKeyBytes);
  }

  if (hasWebCrypto() && !cachedAesKey) {
    try {
      cachedAesKey = await crypto.subtle.importKey(
        "raw",
        cachedKeyBytes as unknown as BufferSource,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    } catch {
      cachedAesKey = null;
    }
  }

  return { keyBytes: cachedKeyBytes, aesKey: cachedAesKey };
}

/** Test hook: drop the in-memory key so a different device key is simulated. */
export function resetOfflineStaffVaultKeyCache(): void {
  cachedKeyBytes = null;
  cachedAesKey = null;
}

export function isEncryptedStaffSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX) || value.startsWith(PLAINTEXT_FALLBACK_PREFIX);
}

/**
 * Encrypt a slow password/PIN hash before it is written to local storage.
 * Encryption failure falls back to a marked plaintext slow hash rather than
 * dropping the credential (the hash itself is never a plaintext secret).
 */
export async function encryptStaffSecret(plainHash: string): Promise<string> {
  if (!plainHash) return "";
  if (isEncryptedStaffSecret(plainHash)) return plainHash;

  const { keyBytes, aesKey } = await getKeyMaterial();
  if (!aesKey) {
    return `${PLAINTEXT_FALLBACK_PREFIX}${plainHash}`;
  }

  try {
    const iv = randomBytes(12);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      aesKey,
      new TextEncoder().encode(plainHash)
    );
    return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
  } catch {
    return `${PLAINTEXT_FALLBACK_PREFIX}${plainHash}`;
  }
}

/** Decrypt a stored hash. Legacy plaintext values are returned unchanged. */
export async function decryptStaffSecret(storedValue: string): Promise<string> {
  if (!storedValue) return "";
  if (storedValue.startsWith(PLAINTEXT_FALLBACK_PREFIX)) {
    return storedValue.slice(PLAINTEXT_FALLBACK_PREFIX.length);
  }
  if (!storedValue.startsWith(ENCRYPTED_PREFIX)) {
    return storedValue;
  }

  const payload = storedValue.slice(ENCRYPTED_PREFIX.length);
  const separator = payload.indexOf(":");
  if (separator < 0) return "";

  try {
    const iv = fromBase64(payload.slice(0, separator));
    const cipherText = fromBase64(payload.slice(separator + 1));
    const { aesKey } = await getKeyMaterial();
    if (!aesKey) return "";
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      aesKey,
      cipherText as unknown as BufferSource
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Wrong device key or corrupted payload: fail closed.
    return "";
  }
}
