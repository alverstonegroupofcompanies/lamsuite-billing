import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unit tests must never depend on a reachable backend. Without this guard the
// online-first services wait for real HTTP timeouts, which makes parallel runs
// slow and flaky. Tests that need a response stub fetch themselves.
const realFetch = globalThis.fetch;
if (realFetch) {
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:/i.test(url)) {
      return Promise.reject(new TypeError(`Network access disabled in tests: ${url}`));
    }
    return realFetch(input, init);
  }) as typeof fetch);
}

// Node 24 exposes an experimental `localStorage` global without Web Storage
// methods, and it shadows jsdom's implementation. Install a working in-memory
// storage whenever the environment's copy is unusable.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  };
}

function installStorage(): void {
  const current = (
    typeof window !== "undefined" ? window.localStorage : (globalThis as { localStorage?: Storage }).localStorage
  ) as Storage | undefined;
  if (current && typeof current.clear === "function" && typeof current.getItem === "function") return;
  const mem = createMemoryStorage();
  try {
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", { value: mem, configurable: true });
    }
    Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
  } catch {
    // Non-configurable in this environment; tests will see the original.
  }
}

installStorage();

afterEach(() => {
  if (typeof document === "undefined") return;
  cleanup();
  document.body.innerHTML = "";
});
