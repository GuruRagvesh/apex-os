'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { ModalPortal } from '../ui/ModalPortal';
import s from './qc.module.css';
export function AttendanceDialog(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <ModalPortal><DialogContent {...props} /></ModalPortal>;
}
function DialogContent({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={s.dialog} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button onClick={onClose} aria-label="Close dialog"><X /></button></header>
    <div className={s.dialogContent}>{children}</div>
  </dialog>;
}
