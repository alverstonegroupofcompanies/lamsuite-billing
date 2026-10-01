import { describe, it, expect, beforeEach } from "vitest";
import {
  getIpcBridge,
  registerMockHandler,
  resetMockHandlers,
  detectRuntime,
  isTauri,
  invokeCommand,
} from "./ipcBridge";

describe("IpcBridge & Runtime Detection (NFR-OS-01, NFR-PERF-01)", () => {
  beforeEach(() => {
    resetMockHandlers();
    delete (globalThis as Record<string, unknown>).__TAURI__;
    delete (globalThis as Record<string, unknown>).__TAURI_IPC__;
    delete (globalThis as Record<string, unknown>).electron;
  });

  it("detects web/mock environment when neither Tauri nor Electron is attached", () => {
    expect(isTauri()).toBe(false);
    const runtime = detectRuntime();
    expect(runtime).toBe("mock");
  });

  it("detects tauri environment when __TAURI__ or __TAURI_IPC__ is present on global scope", () => {
    (globalThis as Record<string, unknown>).__TAURI__ = {
      tauri: { invoke: async () => ({ ok: true }) },
    };
    expect(isTauri()).toBe(true);
    const runtime = detectRuntime();
    expect(runtime).toBe("tauri");
  });

  it("invokes command via window.__TAURI__.tauri.invoke (standard Tauri v1 withGlobalTauri)", async () => {
    (globalThis as Record<string, unknown>).__TAURI__ = {
      tauri: {
        invoke: async (cmd: string, args: any) => {
          return { handledCmd: cmd, receivedArgs: args };
        },
      },
    };

    const result = await invokeCommand<{ handledCmd: string; receivedArgs: any }>("print:export_pdf", { test: 1 });
    expect(result.handledCmd).toBe("print_export_pdf");
    expect(result.receivedArgs).toEqual({ test: 1 });
  });

  it("invokes command via window.__TAURI__.invoke if present", async () => {
    (globalThis as Record<string, unknown>).__TAURI__ = {
      invoke: async (cmd: string, args: any) => {
        return { aliasCmd: cmd, receivedArgs: args };
      },
    };

    const result = await invokeCommand<{ aliasCmd: string; receivedArgs: any }>("db:migrate");
    expect(result.aliasCmd).toBe("db_migrate");
  });

  it("detects electron environment when electron is present on global scope", () => {
    (globalThis as Record<string, unknown>).electron = { ipcRenderer: {} };
    const runtime = detectRuntime();
    expect(runtime).toBe("electron");
  });

  it("invokes registered mock handler and returns result", async () => {
    registerMockHandler("db:ping", async (args) => ({ status: "pong", payload: args }));
    const bridge = getIpcBridge();
    const result = await bridge.invoke<{ status: string; payload: { test: number } }>("db:ping", { test: 123 });

    expect(result).toEqual({ status: "pong", payload: { test: 123 } });
  });

  it("throws clear error when calling unhandled command in mock mode", async () => {
    const bridge = getIpcBridge();
    await expect(bridge.invoke("unknown:command")).rejects.toThrow(/No mock handler registered for unknown:command/);
  });
});
