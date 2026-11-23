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

function readLocal(key: string): UserPreferences {
  try {
    const raw = storage()?.getItem(`${STORAGE_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as UserPreferences) : (memoryStore.get(key) ?? {});
  } catch {
    return memoryStore.get(key) ?? {};
  }
}

function writeLocal(key: string, prefs: UserPreferences): void {
  memoryStore.set(key, prefs);
  try {
    storage()?.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(prefs));
  } catch {
    // Quota or private mode: the in-memory copy still serves this session.
  }
}

/**
 * UI preferences, one set per caller.
 *
 * B8b: `/api/me/preferences` answers for a person, and nobody signs in at the
 * till, so what the till remembers is kept on the till and keyed by the caller
 * that remembers it — a counter today (`cntr_<id>`), a person wherever a person
 * still signs in. The server stays authoritative for anything a person owns.
 */
export class UserPreferencesService {
  private cache = new Map<string, UserPreferences>();

  get(scopeKey: string): UserPreferences {
    if (!scopeKey) return {};
    const cached = this.cache.get(scopeKey);
    if (cached) return cached;
    const local = readLocal(scopeKey);
    this.cache.set(scopeKey, local);
    return local;
  }

  async load(scopeKey: string): Promise<UserPreferences> {
    return this.get(scopeKey);
  }

  async set(scopeKey: string, key: string, value: unknown): Promise<UserPreferences> {
    return this.setMany(scopeKey, { [key]: value });
  }

  async setMany(scopeKey: string, patch: UserPreferences): Promise<UserPreferences> {
    const next = { ...this.get(scopeKey), ...patch };
    this.cache.set(scopeKey, next);
    writeLocal(scopeKey, next);
    return next;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const userPreferencesService = new UserPreferencesService();
