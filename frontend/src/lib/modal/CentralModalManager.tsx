import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModalEscape } from "../ui/modalEscapeManager";

/**
 * Modal stacking with a single portal layer per open modal:
 * - newest layer gets the highest z-index,
 * - focus is trapped inside the top layer,
 * - Esc closes only the top layer (LIFO via modalEscapeManager),
 * - focus returns to the control that opened the layer.
 */

interface ModalStackContextValue {
  allocateZIndex: () => number;
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

export const ModalStackProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const counter = useRef(1000);
  const allocateZIndex = useCallback(() => {
    counter.current += 1;
    return counter.current;
  }, []);
  return (
    <ModalStackContext.Provider value={{ allocateZIndex }}>
      {children}
    </ModalStackContext.Provider>
  );
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.closest("[hidden]")) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
}

function focusableWithin(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

export interface ModalLayerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Return focus to this element instead of the previously focused one. */
  returnFocusTo?: HTMLElement | null;
}

export const ModalLayer: React.FC<ModalLayerProps> = ({
  isOpen,
  onClose,
  children,
  className = "fixed inset-0 flex items-center justify-center bg-black/40 p-4",
  ariaLabel,
  returnFocusTo,
}) => {
  const stack = useContext(ModalStackContext);
  const zIndexRef = useRef(0);
  if (isOpen && zIndexRef.current === 0) {
    zIndexRef.current = stack?.allocateZIndex() ?? 1000;
  }
  if (!isOpen && zIndexRef.current !== 0) {
    zIndexRef.current = 0;
  }

  const layerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useModalEscape(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current =
      returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const timer = window.setTimeout(() => {
      const focusables = focusableWithin(layerRef.current);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        layerRef.current?.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      const target = returnFocusTo ?? previousFocusRef.current;
      if (target && typeof target.focus === "function") {
        target.focus();
      }
    };
  }, [isOpen, returnFocusTo]);

  if (!isOpen) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusables = focusableWithin(layerRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      layerRef.current?.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = layerRef.current?.contains(active as Node);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = (
    <div
      ref={layerRef}
      data-modal-layer="true"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={className}
      style={{ zIndex: zIndexRef.current }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
};

/** Legacy hook retained for callers that render their own overlay. */
export function useModalLayerZIndex(isOpen: boolean): number {
  const stack = useContext(ModalStackContext);
  const [zIndex, setZIndex] = useState(0);
  useEffect(() => {
    if (!isOpen) {
      setZIndex(0);
      return;
    }
    setZIndex(stack?.allocateZIndex() ?? 1000);
  }, [isOpen, stack]);
  return zIndex;
}
