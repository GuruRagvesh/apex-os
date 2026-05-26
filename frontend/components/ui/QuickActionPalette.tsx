'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Search } from 'lucide-react';

interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  category?: string;
}

interface QuickActionPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

export function QuickActionPalette({ isOpen, onClose, actions }: QuickActionPaletteProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? actions.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.description?.toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setFocused(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocused((f) => Math.min(f + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused((f) => Math.max(f - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[focused]) {
          filtered[focused].onClick();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, filtered, focused, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-24 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="apex-scale-in w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dark header with search */}
        <div className="px-5 py-4" style={{ backgroundColor: '#0B1220' }}>
          <p className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Operations Directory</p>
          <div className="flex items-center gap-3 bg-slate-800/60 rounded-xl px-3 py-2.5">
            <Search size={15} className="text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setFocused(0); }}
              placeholder="Search actions..."
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-500 hover:text-white text-xs">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Action list */}
        <div className="bg-white max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">No actions found</div>
          ) : (
            filtered.map((action, i) => (
              <button
                key={action.id}
                onClick={() => { action.onClick(); onClose(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left transition-all"
                style={{
                  backgroundColor: i === focused ? '#F8FAFC' : 'transparent',
                  borderLeft: i === focused ? '3px solid #2563EB' : '3px solid transparent',
                }}
                onMouseEnter={() => setFocused(i)}
              >
                {action.icon && (
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                    {action.icon}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{action.label}</p>
                  {action.description && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{action.description}</p>
                  )}
                </div>
                {action.shortcut && (
                  <kbd className="text-[10px] font-mono bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded flex-shrink-0">
                    {action.shortcut}
                  </kbd>
                )}
                {action.category && (
                  <span className="text-[10px] font-mono uppercase tracking-wide text-slate-300 flex-shrink-0 ml-1">
                    {action.category}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-2.5 flex items-center gap-3 text-[11px] text-slate-400"
          style={{ borderTop: '1px solid #F1F5F9', backgroundColor: '#F8FAFC' }}
        >
          <span><kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[10px]">ESC</kbd> to close</span>
          <span><kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[10px]">↑↓</kbd> to navigate</span>
          <span><kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[10px]">↵</kbd> to select</span>
        </div>
      </div>
    </div>
  );
}
