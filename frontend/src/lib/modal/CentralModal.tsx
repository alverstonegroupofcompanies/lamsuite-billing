import React, { useEffect, ReactNode } from 'react';
import { useModal } from './CentralModalManager';

/**
 * CentralModal is a thin wrapper that registers any modal content with the central
 * modal manager. It ensures the modal is rendered via the portal, participates in
 * the global Escape‑key handling, and is automatically removed when `isOpen`
 * becomes false.
 */
export const CentralModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}> = ({ isOpen, onClose, children }) => {
  const { openModal, closeModal } = useModal();

  useEffect(() => {
    if (!isOpen) return undefined;
    // Open the modal through the manager and capture its id.
    const modalId = openModal(children, onClose);
    // Cleanup when the component unmounts or isOpen toggles off.
    return () => {
      closeModal(modalId);
    };
  }, [isOpen, children, onClose, openModal, closeModal]);

  // This component does not render anything directly; the modal content is
  // rendered by the central manager's portal.
  return null;
};
