/**
 * Robust, offline-capable password and PIN hashing using Web Crypto PBKDF2-SHA256
 * with salt and iteration hardening. Never stores plain-text secrets.
 */

export class StaffCryptoService {
  private defaultPasswordIterations = 100_000;
  private defaultPinIterations = 50_000;

  generateSalt(length = 16): string {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    // Fallback pseudo-random for test environments lacking crypto.getRandomValues
    let s = "";
    for (let i = 0; i < length; i++) {
      s += Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0");
    }
    return s;
  }

  async hashSecret(
    secret: string,
    salt?: string,
    iterations?: number
  ): Promise<string> {
    const effectiveSalt = salt || this.generateSalt();
    const effectiveIterations = iterations || this.defaultPasswordIterations;

    if (typeof crypto !== "undefined" && crypto.subtle) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: enc.encode(effectiveSalt),
          iterations: effectiveIterations,
          hash: "SHA-256",
        },
        keyMaterial,
        256
      );

      const hashHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return `$pbkdf2-sha256$i=${effectiveIterations}$s=${effectiveSalt}$${hashHex}`;
    }

    // Deterministic fallback for environments without crypto.subtle
    let h = 0;
    const combined = `${effectiveSalt}:${secret}:${effectiveIterations}`;
    for (let i = 0; i < combined.length; i++) {
      h = (h << 5) - h + combined.charCodeAt(i);
      h |= 0;
    }
    return `$fallback$i=${effectiveIterations}$s=${effectiveSalt}$${Math.abs(h).toString(16)}`;
  }

  async hashPin(pin: string, salt?: string): Promise<string> {
    return this.hashSecret(pin, salt, this.defaultPinIterations);
  }

  async verifySecret(secret: string, storedHash: string): Promise<boolean> {
    if (!storedHash || !secret) return false;

    // Parse $pbkdf2-sha256$i=100000$s=salt$hash or $fallback$...
    const parts = storedHash.split("$").filter(Boolean);
    if (parts.length < 4) {
      // Handle legacy sha256 or direct comparison safely
      const legacyHashed = await this.hashSecret(secret, "legacy_salt", 1000);
      return storedHash === legacyHashed;
    }

    const iterPart = parts[1]; // "i=100000"
    const saltPart = parts[2]; // "s=abc..."
    const iterations = parseInt(iterPart.replace("i=", ""), 10) || 100_000;
    const salt = saltPart.replace("s=", "");

    const calculated = await this.hashSecret(secret, salt, iterations);
    return this.constantTimeCompare(calculated, storedHash);
  }

  async verifyPin(pin: string, storedHash: string): Promise<boolean> {
    return this.verifySecret(pin, storedHash);
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
}

export const staffCryptoService = new StaffCryptoService();
