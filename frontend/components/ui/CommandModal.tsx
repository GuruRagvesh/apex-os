'use client';

import React, { useEffect } from 'react';

interface CommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
  showPulsingDot?: boolean;
}

const SIZE_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function CommandModal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  size = 'md',
  footer,
  children,
  showPulsingDot = true,
}: CommandModalProps) {
  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`apex-scale-in w-full ${SIZE_MAP[size]} rounded-3xl shadow-2xl overflow-hidden`}
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dark navy header */}
        <div
          className="px-6 py-5 flex items-center gap-3"
          style={{ backgroundColor: '#0B1220' }}
        >
          {showPulsingDot && (
            <span
              className="apex-pulse-dot w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: '#2563EB' }}
            />
          )}
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400 flex-shrink-0">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors flex-shrink-0 ml-2"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* White body */}
        <div className="bg-white px-6 py-5">
          {children}
        </div>

        {/* Optional footer */}
        {footer && (
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 rounded-b-3xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
