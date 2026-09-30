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

export function detectRuntime(): DesktopRuntime {
  const g = getGlobalScope();
  if (g.__TAURI__) {
    return "tauri";
  }
  if (g.electron) {
    return "electron";
  }
  return "mock";
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
    const g = getGlobalScope();

    if (runtime === "tauri") {
      const tauri = g.__TAURI__ as { invoke: <R>(cmd: string, a?: unknown) => Promise<R> };
      return await tauri.invoke<T>(command, args);
    }

    if (runtime === "electron") {
      const electron = g.electron as {
        invoke?: <R>(cmd: string, a?: unknown) => Promise<R>;
        [key: string]: unknown;
      };
      if (typeof electron.invoke === "function") {
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
