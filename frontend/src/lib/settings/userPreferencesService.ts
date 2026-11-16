import { getResolvedApiBaseUrl } from "../../config/env";

export type UserPreferences = Record<string, unknown>;

const STORAGE_PREFIX = "lamsuite_user_prefs_";
const memoryStore = new Map<string, UserPreferences>();

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Access can throw in private mode.
  }
  return null;
}

function readLocal(userId: string): UserPreferences {
  try {
    const raw = storage()?.getItem(`${STORAGE_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as UserPreferences) : (memoryStore.get(userId) ?? {});
  } catch {
    return memoryStore.get(userId) ?? {};
  }
}

function writeLocal(userId: string, prefs: UserPreferences): void {
  memoryStore.set(userId, prefs);
  try {
    storage()?.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(prefs));
  } catch {
    // Quota or private mode: the in-memory copy still serves this session.
  }
}

function authHeaders(): Record<string, string> {
  let token: string | null = null;
  try {
    token = storage()?.getItem("staff_token") ?? null;
  } catch {
    token = null;
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Per-user UI preferences with an optimistic local cache.
 * The server is authoritative across devices; failures never block the counter.
 */
export class UserPreferencesService {
  private cache = new Map<string, UserPreferences>();
  private inflight = new Map<string, Promise<UserPreferences>>();

  get(userId: string): UserPreferences {
    if (!userId) return {};
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const local = readLocal(userId);
    this.cache.set(userId, local);
    return local;
  }

  async load(userId: string): Promise<UserPreferences> {
    if (!userId) return {};
    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const request = this.fetchRemote(userId)
      .then((remote) => {
        const merged = { ...readLocal(userId), ...remote };
        this.cache.set(userId, merged);
        writeLocal(userId, merged);
        return merged;
      })
      .catch(() => this.get(userId))
      .finally(() => {
        this.inflight.delete(userId);
      });

    this.inflight.set(userId, request);
    return request;
  }

  async set(userId: string, key: string, value: unknown): Promise<UserPreferences> {
    return this.setMany(userId, { [key]: value });
  }

  async setMany(userId: string, patch: UserPreferences): Promise<UserPreferences> {
    const next = { ...this.get(userId), ...patch };
    this.cache.set(userId, next);
    writeLocal(userId, next);
    await this.pushRemote(userId, patch).catch(() => false);
    return next;
  }

  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  private async fetchRemote(userId: string): Promise<UserPreferences> {
    const res = await fetch(`${getResolvedApiBaseUrl()}/api/me/preferences`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`Preferences HTTP ${res.status}`);
    const body = await res.json();
    return (body?.preferences ?? {}) as UserPreferences;
  }

  private async pushRemote(userId: string, patch: UserPreferences): Promise<boolean> {
    const res = await fetch(`${getResolvedApiBaseUrl()}/api/me/preferences`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ preferences: patch }),
    });
    return res.ok;
  }
}

export const userPreferencesService = new UserPreferencesService();
