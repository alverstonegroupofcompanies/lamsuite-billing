import { describe, it, expect, beforeEach } from "vitest";
import {
  getIpcBridge,
  registerMockHandler,
  resetMockHandlers,
  detectRuntime,
  isTauri,
  isCredentialKey,
  invokeCommand,
} from "./ipcBridge";

describe("IpcBridge & Runtime Detection (NFR-OS-01, NFR-PERF-01)", () => {
  beforeEach(() => {
    resetMockHandlers();
    localStorage.clear();
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

describe("Workstation tokens never fall back to web storage (CNT-006)", () => {
  const TOKEN = "lsd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    resetMockHandlers();
    localStorage.clear();
  });

  it("recognises every token key the till uses", () => {
    expect(isCredentialKey("device_token")).toBe(true);
    expect(isCredentialKey("store:7:device_token")).toBe(true);
    expect(isCredentialKey("store:7:refresh_token")).toBe(true);
    expect(isCredentialKey("access_token")).toBe(true);
    expect(isCredentialKey("store:7:profile")).toBe(false);
    expect(isCredentialKey("store_device_profile")).toBe(false);
    expect(isCredentialKey("offline_staff_vault_key")).toBe(false);
  });

  it("keeps a token out of web storage but still serves it in the session", async () => {
    await invokeCommand("secure_store_set", { key: "store:7:device_token", value: TOKEN });

    expect(localStorage.getItem("lamsuite_vault_store:7:device_token")).toBeNull();
    expect(localStorage.length).toBe(0);
    await expect(invokeCommand("secure_store_get", { key: "store:7:device_token" })).resolves.toBe(TOKEN);
  });

  it("still persists non-secret payloads across a reload", async () => {
    const profile = JSON.stringify({ store_id: "7", counter_code: "C01" });
    await invokeCommand("secure_store_set", { key: "store:7:profile", value: profile });

    expect(localStorage.getItem("lamsuite_vault_store:7:profile")).toBe(profile);

    resetMockHandlers();
    await expect(invokeCommand("secure_store_get", { key: "store:7:profile" })).resolves.toBe(profile);
  });

  it("refuses to read a token a pre-2.2 build left in web storage", async () => {
    localStorage.setItem("lamsuite_vault_device_token", "lsd_legacy_plaintext");

    await expect(invokeCommand("secure_store_get", { key: "device_token" })).resolves.toBeNull();
  });

  it("deleting a credential leaves no web-storage copy behind", async () => {
    await invokeCommand("secure_store_set", { key: "store:7:profile", value: JSON.stringify({ a: 1 }) });
    await invokeCommand("secure_store_delete", { key: "store:7:profile" });
    expect(localStorage.getItem("lamsuite_vault_store:7:profile")).toBeNull();

    await invokeCommand("secure_store_set", { key: "store:7:device_token", value: TOKEN });
    await invokeCommand("secure_store_delete", { key: "store:7:device_token" });
    await expect(invokeCommand("secure_store_get", { key: "store:7:device_token" })).resolves.toBeNull();
  });
});
