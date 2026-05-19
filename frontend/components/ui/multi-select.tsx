'use client';

import { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Search, Check } from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  avatar?: string;
  sublabel?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className,
  disabled,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sublabel ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const selected = options.filter((o) => value.includes(o.value));

  const toggle = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  };

  const remove = (optValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optValue));
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <div
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'min-h-[38px] w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white',
          'flex items-center flex-wrap gap-1.5 cursor-pointer',
          'focus-within:ring-2 focus-within:ring-indigo-500',
          disabled && 'opacity-60 cursor-not-allowed bg-slate-50',
          open && 'ring-2 ring-indigo-500',
        )}
      >
        {selected.length === 0 ? (
          <span className="text-slate-400 text-sm flex-1">{placeholder}</span>
        ) : (
          selected.map((opt) => (
            <span
              key={opt.value}
              className="flex items-center gap-1 bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              {opt.avatar ? (
                <img src={opt.avatar} alt={opt.label} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                  {getInitials(opt.label)}
                </span>
              )}
              {opt.label}
              <button
                type="button"
                onClick={(e) => remove(opt.value, e)}
                className="hover:text-indigo-900 ml-0.5"
              >
                <X size={10} />
              </button>
            </span>
          ))
        )}
        <ChevronDown
          size={14}
          className={cn('ml-auto text-slate-400 flex-shrink-0 transition-transform', open && 'rotate-180')}
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search size={13} className="text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 text-sm outline-none text-slate-700 placeholder:text-slate-400"
            />
          </div>

          {/* Options */}
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400 text-center">No results</li>
            ) : (
              filtered.map((opt) => {
                const isSelected = value.includes(opt.value);
                return (
                  <li
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors',
                      isSelected && 'bg-indigo-50',
                    )}
                  >
                    {/* Avatar */}
                    {opt.avatar ? (
                      <img src={opt.avatar} alt={opt.label} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {getInitials(opt.label)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="text-[10px] text-slate-400 truncate">{opt.sublabel}</p>
                      )}
                    </div>
                    {isSelected && <Check size={14} className="text-indigo-600 flex-shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
