import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ModalEscapeManager", () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    listeners = {};
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;

    (globalThis as any).window = {
      addEventListener: (type: string, handler: (e: any) => void, _capture?: boolean) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(handler);
      },
      removeEventListener: (type: string, handler: (e: any) => void) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((h) => h !== handler);
        }
      },
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
      }),
    };

    (globalThis as any).document = {
      querySelectorAll: vi.fn().mockReturnValue([]),
      querySelector: vi.fn().mockReturnValue(null),
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    vi.resetModules();
  });

  it("registers and closes modals in LIFO order on Escape", async () => {
    const { modalEscapeManager } = await import("./modalEscapeManager");

    const close1 = vi.fn();
    const close2 = vi.fn();

    modalEscapeManager.register(close1);
    modalEscapeManager.register(close2);

    expect(modalEscapeManager.hasOpenModal()).toBe(true);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();

    // Trigger keydown Escape
    const escapeEvent = {
      key: "Escape",
      preventDefault,
      stopPropagation,
      stopImmediatePropagation,
    };

    // Dispatch to keydown listeners
    const keydownHandlers = listeners["keydown"] || [];
    expect(keydownHandlers.length).toBeGreaterThan(0);
    keydownHandlers.forEach((h) => h(escapeEvent));

    // Topmost modal (close2) should be closed first
    expect(close2).toHaveBeenCalledTimes(1);
    expect(close1).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);

    // Second Escape closes close1
    keydownHandlers.forEach((h) => h(escapeEvent));
    expect(close1).toHaveBeenCalledTimes(1);
    expect(modalEscapeManager.hasOpenModal()).toBe(false);
  });

  it("handles iframe message MODAL_ESCAPE to close top modal", async () => {
    const { modalEscapeManager } = await import("./modalEscapeManager");

    const close = vi.fn();
    modalEscapeManager.register(close);

    const messageHandlers = listeners["message"] || [];
    expect(messageHandlers.length).toBeGreaterThan(0);

    messageHandlers.forEach((h) => h({ data: { type: "MODAL_ESCAPE" } }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(modalEscapeManager.hasOpenModal()).toBe(false);
  });

  it("prevents fullscreen exit when Lock Screen is active without dismissing the lock screen", async () => {
    const { modalEscapeManager } = await import("./modalEscapeManager");

    (globalThis as any).document.querySelector = vi.fn().mockImplementation((sel: string) => {
      if (sel === '[data-lock-overlay="true"]') {
        return { clientHeight: 500 };
      }
      return null;
    });

    expect(modalEscapeManager.isLockOverlayActive()).toBe(true);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();

    const escapeEvent = {
      key: "Escape",
      preventDefault,
      stopPropagation,
      stopImmediatePropagation,
    };

    const keydownHandlers = listeners["keydown"] || [];
    keydownHandlers.forEach((h) => h(escapeEvent));

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });

  it("falls back to clicking close button on DOM overlay if modal is not in memory stack", async () => {
    const { modalEscapeManager } = await import("./modalEscapeManager");

    const clickSpy = vi.fn();
    const mockButton = { click: clickSpy };

    (globalThis as any).document.querySelectorAll = vi.fn().mockImplementation((sel: string) => {
      if (sel.includes("fixed.inset-0")) {
        return [
          {
            clientHeight: 500,
            querySelector: (btnSel: string) => (btnSel.includes("data-modal-close") ? mockButton : null),
            querySelectorAll: () => [],
          },
        ];
      }
      return [];
    });

    expect(modalEscapeManager.hasOpenModal()).toBe(true);

    const preventDefault = vi.fn();
    const escapeEvent = {
      key: "Escape",
      preventDefault,
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    const keydownHandlers = listeners["keydown"] || [];
    keydownHandlers.forEach((h) => h(escapeEvent));

    expect(preventDefault).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
