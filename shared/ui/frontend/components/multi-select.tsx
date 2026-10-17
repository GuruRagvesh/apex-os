'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { X, ChevronDown, Search, Check } from 'lucide-react';
import { cn, getInitials } from '@apex/shared-utilities';

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
  /** Id of the trigger button, so a visible <label htmlFor> names it. */
  id?: string;
  /** Form name; the search box is named `${name}-search`. */
  name?: string;
  /** Accessible name when no visible label points at `id`. */
  label?: string;
  /** Id of an element that labels the control (alternative to `label`). */
  labelledBy?: string;
}

/**
 * Multi-select listbox: a button trigger, a labelled search box and an
 * aria-multiselectable option list. Keyboard: Enter/Space/ArrowDown open,
 * Arrow keys move, Enter selects, Escape closes.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className,
  disabled,
  id,
  name,
  label,
  labelledBy,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const generated = useId().replace(/:/g, '');
  const baseId = id ?? `multi-select-${generated}`;
  const listId = `${baseId}-listbox`;
  const searchId = `${baseId}-search`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

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

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

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

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(0);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setSearch('');
    if (refocus) triggerRef.current?.focus();
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openList();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(filtered.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active]) toggle(filtered[active].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <div
        className={cn(
          'min-h-[38px] w-full px-2.5 py-1.5 text-sm border border-slate-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100',
          'flex items-center flex-wrap gap-1.5',
          'focus-within:ring-2 focus-within:ring-indigo-500',
          disabled && 'opacity-60 cursor-not-allowed bg-slate-50',
          open && 'ring-2 ring-indigo-500',
        )}
      >
        {selected.map((opt) => (
          <span
            key={opt.value}
            className="flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 rounded-full px-2 py-0.5 text-xs font-medium"
          >
            {opt.avatar ? (
              <img src={opt.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                {getInitials(opt.label)}
              </span>
            )}
            {opt.label}
            <button
              type="button"
              onClick={(e) => remove(opt.value, e)}
              disabled={disabled}
              aria-label={`Remove ${opt.label}`}
              className="hover:text-indigo-900 ml-0.5"
            >
              <X size={10} aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          id={baseId}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={onTriggerKey}
          className={cn('flex flex-1 items-center gap-1.5 min-w-[6rem] text-left outline-none', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
        >
          <span className={cn('flex-1 text-sm', selected.length === 0 ? 'text-slate-400' : 'sr-only')}>
            {selected.length === 0 ? placeholder : `${selected.length} selected`}
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn('ml-auto text-slate-400 flex-shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-gray-700">
            <Search size={13} aria-hidden="true" className="text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              id={searchId}
              name={name ? `${name}-search` : searchId}
              type="text"
              role="combobox"
              aria-label={label ? `Search ${label}` : 'Search options'}
              aria-controls={listId}
              aria-expanded
              aria-autocomplete="list"
              aria-activedescendant={filtered[active] ? optionId(active) : undefined}
              autoComplete="off"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActive(0); }}
              onKeyDown={onListKey}
              placeholder="Search..."
              className="flex-1 text-sm outline-none text-slate-700 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-400 bg-transparent"
            />
          </div>

          {/* Options */}
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label ?? 'Options'}
            className="max-h-52 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-xs text-slate-400 dark:text-gray-500 text-center">No results</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = value.includes(opt.value);
                return (
                  <li
                    key={opt.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active || undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors',
                      isSelected && 'bg-indigo-50 dark:bg-indigo-900/30',
                      i === active && 'outline outline-2 -outline-offset-2 outline-indigo-500',
                    )}
                  >
                    {/* Avatar */}
                    {opt.avatar ? (
                      <img src={opt.avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div aria-hidden="true" className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {getInitials(opt.label)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 truncate">{opt.sublabel}</p>
                      )}
                    </div>
                    {isSelected && <Check size={14} aria-hidden="true" className="text-indigo-600 flex-shrink-0" />}
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
