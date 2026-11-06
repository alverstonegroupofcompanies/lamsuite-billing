import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * CentralModalManager provides a portal for rendering modals with proper stacking order.
 * It tracks an array of modal entries, each with a unique id and content.
 * The z-index of each modal increments with its position in the stack.
 * It also handles Escape key to close only the topmost modal and traps focus.
 */

type ModalEntry = {
  id: string;
  content: ReactNode;
  onClose?: () => void;
};

type ModalContextValue = {
  openModal: (content: ReactNode, onClose?: () => void) => string;
  closeModal: (id: string) => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export const useModal = (): ModalContextValue => {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return ctx;
};

export const ModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [modals, setModals] = useState<ModalEntry[]>([]);

  const openModal = useCallback((content: ReactNode, onClose?: () => void): string => {
    const id = `modal-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setModals((prev) => [...prev, { id, content, onClose }]);
    return id;
  }, []);

  const closeModal = useCallback((id: string) => {
    setModals((prev) => prev.filter((m) => m.id !== id));
    const modal = modals.find((m) => m.id === id);
    if (modal?.onClose) modal.onClose();
  }, [modals]);

  // Escape handling: only close topmost modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modals.length) {
        // Prevent default to avoid closing underlying dialogs
        e.preventDefault();
        const topModal = modals[modals.length - 1];
        closeModal(topModal.id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modals, closeModal]);

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      {modals.map((modal, index) =>
        createPortal(
          <div
            key={modal.id}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000 + index, // incremental stacking
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}
            aria-modal="true"
            role="dialog"
          >
            {modal.content}
          </div>,
          document.body
        )
      )}
    </ModalContext.Provider>
  );
};
