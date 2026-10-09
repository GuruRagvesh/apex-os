'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ActionProps {
  label: string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
}

interface CommandModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  primaryAction?: ActionProps;
  secondaryAction?: ActionProps;
  viewFullPageAction?: ActionProps;
  onClose: () => void;
  // Legacy compat props (ignored in new design but accepted to avoid TS errors)
  isOpen?: boolean;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  showPulsingDot?: boolean;
}

export function CommandModal({
  open,
  title,
  children,
  primaryAction,
  secondaryAction,
  viewFullPageAction,
  onClose,
  // legacy compat
  isOpen,
  footer,
}: CommandModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  // Support both `open` and legacy `isOpen`
  const isVisible = open ?? isOpen ?? false;

  useEffect(() => { setMounted(true); }, []);

  // While open: the page behind cannot scroll (the dashboard scrolls inside
  // <main>, the rest of the app on <body>), and on close focus returns to
  // whatever opened the popup.
  useEffect(() => {
    if (!isVisible) return;
    const opener = document.activeElement as HTMLElement | null;
    const main = document.getElementById('apex-main-content');
    const prevBody = document.body.style.overflow;
    const prevMain = main?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      if (main) main.style.overflow = prevMain;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [isVisible]);

  // Check and register window matchMedia for mobile layout (under 640px)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    setIsMobile(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // Close on Escape pressed
  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  // Trap keyboard focus within active modal for maximum accessibility
  useEffect(() => {
    if (!isVisible) return;
    const focusableElementsString = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const modalEl = modalRef.current;
    if (!modalEl) return;

    // The trap listener is registered once per opening and always removed on
    // close. (It used to be added inside a timeout whose cleanup was thrown
    // away, so every opening left one more listener behind.)
    const focusables = () => Array.from(modalEl.querySelectorAll<HTMLElement>(focusableElementsString));
    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstTabEl = items[0];
      const lastTabEl = items[items.length - 1];
      if (!modalEl.contains(document.activeElement)) {
        firstTabEl.focus();
        e.preventDefault();
      } else if (e.shiftKey && document.activeElement === firstTabEl) {
        lastTabEl.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastTabEl) {
        firstTabEl.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleTabTrap);
    const timer = setTimeout(() => focusables()[0]?.focus(), 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleTabTrap);
    };
  }, [isVisible]);

  // Handle click outside modal content
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  // Set framer motion configurations responsively
  const motionConfig = isMobile
    ? {
        initial: { y: '100%' as const },
        animate: { y: 0 },
        exit: { y: '100%' as const },
        transition: { type: 'spring' as const, damping: 25, stiffness: 220 },
      }
    : {
        initial: { opacity: 0, scale: 0.95, y: 15 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.95, y: 15 },
        transition: { duration: 0.22, type: 'tween' as const },
      };

  // Rendered into <body>: a transformed ancestor (the dashboard's fade-in
  // animation keeps a transform) made "fixed" position relative to the page
  // content box, so the popup and its backdrop sat inside the content area
  // instead of over the whole screen.
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <div
          // z-[300]: above the Quick Action dock (z 200), which otherwise sat on top of the popup.
          className={`fixed inset-0 z-[300] flex select-none ${
            isMobile ? 'items-end justify-center p-0' : 'items-center justify-center p-4 md:p-6'
          }`}
        >
          {/* Backdrop blur overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleOverlayClick}
            className="absolute inset-0 bg-[#0B1220]/65 backdrop-blur-md cursor-pointer"
          />

          {/* Modal / Bottom Sheet Container */}
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            {...motionConfig}
            className={`apex-section-border relative bg-white dark:bg-[#0F172A] shadow-[0_20px_50px_rgba(11,18,32,0.3)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col border z-10 ${
              isMobile
                ? 'w-full max-h-[85vh] h-auto rounded-t-[24px] rounded-b-none border-b-0'
                : 'w-full max-w-2xl rounded-[24px] max-h-[90vh] md:max-h-[85vh]'
            }`}
          >
            {/* Mobile Grab Handle Drag Indicator */}
            {isMobile && (
              <div
                className="w-full flex justify-center py-2.5 shrink-0 bg-[#0B1220] cursor-pointer"
                onClick={onClose}
              >
                <div className="w-12 h-1 bg-slate-600 rounded-full opacity-80" />
              </div>
            )}

            {/* Header: Dark Navy */}
            <div className="bg-[#0B1220] px-6 py-4 flex items-center justify-between border-b border-slate-900 shrink-0 text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                <h3 id={titleId} className="font-sans font-bold text-sm uppercase tracking-wider text-slate-100">
                  {title}
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close modal"
                className="p-1 px-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content: White Body */}
            <div className="p-6 overflow-y-auto bg-white dark:bg-[#0F172A] text-[#0F172A] dark:text-slate-100 leading-relaxed flex-1">
              {children}
            </div>

            {/* Footer containing navigation, secondary and primary actions */}
            {(viewFullPageAction || primaryAction || secondaryAction || footer) && (
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-150 dark:border-slate-800 flex flex-wrap items-center justify-between shrink-0 gap-3">
                <div>
                  {viewFullPageAction ? (
                    <button
                      onClick={viewFullPageAction.onClick}
                      className="px-4 py-2.5 text-blue-600 dark:text-blue-400 hover:text-white border border-blue-200 dark:border-blue-900/60 hover:bg-blue-600 rounded-xl font-bold text-xs cursor-pointer transition-all flex items-center gap-1.5 focus:outline-none"
                    >
                      {viewFullPageAction.icon ? (
                        <viewFullPageAction.icon className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5" />
                      )}
                      <span>{viewFullPageAction.label}</span>
                    </button>
                  ) : footer ? (
                    <div>{footer}</div>
                  ) : (
                    <div />
                  )}
                </div>
                <div className="flex gap-2.5">
                  {secondaryAction ? (
                    <button
                      onClick={secondaryAction.onClick}
                      className="px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-xs cursor-pointer transition-all focus:outline-none"
                    >
                      {secondaryAction.icon && <secondaryAction.icon className="w-3.5 h-3.5 inline mr-1.5" />}
                      {secondaryAction.label}
                    </button>
                  ) : (
                    <button
                      onClick={onClose}
                      className="px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs cursor-pointer transition-all focus:outline-none"
                    >
                      Close
                    </button>
                  )}
                  {primaryAction && (
                    <button
                      onClick={primaryAction.onClick}
                      className={`px-5 py-2 text-white font-bold text-xs rounded-xl cursor-pointer shadow-md hover:-translate-y-0.5 transition-all focus:outline-none flex items-center gap-1.5 ${
                        primaryAction.label.toLowerCase().includes('delete') || primaryAction.label.toLowerCase().includes('reject') || primaryAction.label.toLowerCase().includes('decline')
                          ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                          : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200 dark:shadow-none'
                      }`}
                    >
                      {primaryAction.icon && <primaryAction.icon className="w-3.5 h-3.5" />}
                      <span>{primaryAction.label}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default CommandModal;
