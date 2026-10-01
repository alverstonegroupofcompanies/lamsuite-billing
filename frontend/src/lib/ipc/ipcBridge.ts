export type DesktopRuntime = "tauri" | "electron" | "mock";

export type MockHandler = (args?: unknown) => Promise<unknown> | unknown;

const mockHandlers = new Map<string, MockHandler>();

export function registerMockHandler(command: string, handler: MockHandler): void {
  mockHandlers.set(command, handler);
}

export function resetMockHandlers(): void {
  mockHandlers.clear();
}

function getGlobalScope(): Record<string, unknown> {
  if (typeof window !== "undefined") return window as unknown as Record<string, unknown>;
  if (typeof globalThis !== "undefined") return globalThis as unknown as Record<string, unknown>;
  return {};
}

/**
 * Checks whether the application is currently running inside the Tauri native desktop window.
 */
export function isTauri(): boolean {
  const g = getGlobalScope() as any;
  return Boolean(g.__TAURI_IPC__ || g.__TAURI__ || g.__TAURI_METADATA__);
}

export function detectRuntime(): DesktopRuntime {
  const g = getGlobalScope() as any;
  if (isTauri()) {
    return "tauri";
  }
  if (g.electron) {
    return "electron";
  }
  return "mock";
}

async function callTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const g = getGlobalScope() as any;

  // 1. Check window.__TAURI__?.tauri?.invoke (standard withGlobalTauri in Tauri v1)
  if (typeof g.__TAURI__?.tauri?.invoke === "function") {
    return await g.__TAURI__.tauri.invoke(cmd, args);
  }

  // 2. Check window.__TAURI__?.invoke
  if (typeof g.__TAURI__?.invoke === "function") {
    return await g.__TAURI__.invoke(cmd, args);
  }

  // 3. Check official @tauri-apps/api/tauri invoke (uses window.__TAURI_IPC__)
  if (typeof g.__TAURI_IPC__ === "function") {
    try {
      const { invoke } = await import("@tauri-apps/api/tauri");
      return await invoke<T>(cmd, args);
    } catch (err) {
      console.warn("Dynamic import of @tauri-apps/api/tauri invoke failed:", err);
    }
  }

  throw new Error(`Tauri invoke is not available in current window for command: ${cmd}`);
}

export interface IpcBridge {
  runtime: DesktopRuntime;
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

class DesktopIpcBridge implements IpcBridge {
  get runtime(): DesktopRuntime {
    return detectRuntime();
  }

  async invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    const runtime = this.runtime;

    if (runtime === "tauri") {
      // Transform command names like "db:insert" -> "db_insert", "db:findAll" -> "db_find_all"
      const snakeCmd = command
        .replace(/:/g, "_")
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase();

      try {
        return await callTauri<T>(snakeCmd, args);
      } catch (tauriError) {
        try {
          return await callTauri<T>(command, args);
        } catch {
          // If Rust command is not implemented or during dev fallback, check mockHandlers
          const handler = mockHandlers.get(command);
          if (handler) {
            return (await handler(args)) as T;
          }
          throw tauriError;
        }
      }
    }

    if (runtime === "electron") {
      const electron = (getGlobalScope() as any).electron as {
        invoke?: <R>(cmd: string, a?: unknown) => Promise<R>;
        [key: string]: unknown;
      };
      if (typeof electron?.invoke === "function") {
        return await electron.invoke<T>(command, args);
      }
      throw new Error(`Electron IPC invoked without registered invoke handler for ${command}`);
    }

    // Mock / Web mode (used for Vitest tests and development previews)
    const handler = mockHandlers.get(command);
    if (!handler) {
      throw new Error(`No mock handler registered for ${command} in mock mode.`);
    }
    return (await handler(args)) as T;
  }
}

let bridgeInstance: IpcBridge | null = null;

export function getIpcBridge(): IpcBridge {
  if (!bridgeInstance) {
    bridgeInstance = new DesktopIpcBridge();
  }
  return bridgeInstance;
}

/**
 * Central wrapper to invoke backend commands safely in Tauri or fallback to mock/browser.
 */
export async function invokeCommand<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return await getIpcBridge().invoke<T>(command, args);
}
