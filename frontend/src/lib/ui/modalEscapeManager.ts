import { useEffect, useRef } from "react";

type ModalCloseCallback = () => void;

class ModalEscapeManager {
  private stack: ModalCloseCallback[] = [];
  private isListening = false;

  constructor() {
    this.init();
  }

  /**
   * Register a modal's close handler.
   * Returns an unregister cleanup function.
   */
  register(onClose: ModalCloseCallback): () => void {
    this.stack.push(onClose);
    return () => {
      this.unregister(onClose);
    };
  }

  /**
   * Unregister a modal close handler.
   */
  unregister(onClose: ModalCloseCallback): void {
    const idx = this.stack.lastIndexOf(onClose);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  /**
   * Check if a security lock overlay is currently active.
   */
  isLockOverlayActive(): boolean {
    if (typeof document === "undefined") return false;
    const lockEl = document.querySelector('[data-lock-overlay="true"]');
    if (!lockEl) return false;
    const style = window.getComputedStyle(lockEl);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  /**
   * Check if any modal is currently registered in memory or present in the DOM.
   */
  hasOpenModal(): boolean {
    if (this.stack.length > 0) return true;
    if (typeof document === "undefined") return false;

    // Fallback: Check DOM for visible fixed overlays / dialogs
    const overlays = document.querySelectorAll(
      '.fixed.inset-0:not(.pointer-events-none):not([data-lock-overlay="true"]), [role="dialog"], [aria-modal="true"], [data-modal]'
    );
    for (let i = 0; i < overlays.length; i++) {
      const el = overlays[i] as HTMLElement;
      const style = window.getComputedStyle(el);
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        el.clientHeight > 0
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Close the topmost modal. Returns true if a modal was handled.
   */
  closeTopModal(): boolean {
    if (this.stack.length > 0) {
      const onClose = this.stack.pop();
      if (onClose) {
        try {
          onClose();
        } catch (err) {
          console.error("Error closing modal on Escape:", err);
        }
        return true;
      }
    }

    if (typeof document === "undefined") return false;

    // Fallback DOM close: Find topmost visible overlay and click its close button
    const overlays = Array.from(
      document.querySelectorAll(
        '.fixed.inset-0:not(.pointer-events-none):not([data-lock-overlay="true"]), [role="dialog"], [aria-modal="true"], [data-modal]'
      )
    ).filter((el) => {
      const hEl = el as HTMLElement;
      const style = window.getComputedStyle(hEl);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        hEl.clientHeight > 0
      );
    });

    if (overlays.length > 0) {
      const topOverlay = overlays[overlays.length - 1] as HTMLElement;
      // Look for standard close button
      const closeBtn = topOverlay.querySelector<HTMLButtonElement>(
        '[data-modal-close], button[aria-label="Close"], button[aria-label="close"], button[aria-label="Cancel"]'
      );

      if (closeBtn) {
        closeBtn.click();
        return true;
      }

      // Look for button containing X or Cancel or Close
      const buttons = Array.from(topOverlay.querySelectorAll("button"));
      for (const btn of buttons) {
        const text = (btn.textContent || "").trim();
        if (
          text === "✕" ||
          text === "X" ||
          text.toLowerCase() === "cancel" ||
          text.toLowerCase() === "close" ||
          Boolean(btn.querySelector("svg.lucide-x, svg.lucide-x-circle"))
        ) {
          btn.click();
          return true;
        }
      }
    }

    return false;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // 1. If screen lock overlay is active and no modal on top, prevent Escape from exiting fullscreen
      if (this.isLockOverlayActive() && this.stack.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // 2. If a modal is open, ALWAYS prevent default immediately in capture phase
      // so macOS / WebKit does NOT exit full screen!
      if (this.hasOpenModal()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.closeTopModal();
      }
    }
  };

  private handleWindowMessage = (e: MessageEvent) => {
    // If an iframe inside a modal (e.g. print preview) sent an ESCAPE message
    if (e.data && (e.data.type === "MODAL_ESCAPE" || e.data.type === "CLOSE_MODAL")) {
      this.closeTopModal();
    }
  };

  init() {
    if (this.isListening || typeof window === "undefined") return;
    this.isListening = true;

    // Capture phase ensures we intercept Escape before any child or browser handler
    window.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("message", this.handleWindowMessage);
  }
}

export const modalEscapeManager = new ModalEscapeManager();

/**
 * React hook to register a modal's close callback on the global Escape stack.
 * Preserves LIFO ordering across re-renders using ref.
 */
export function useModalEscape(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => {
      onCloseRef.current();
    };
    return modalEscapeManager.register(handler);
  }, [isOpen]);
}
