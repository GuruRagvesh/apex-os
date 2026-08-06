'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Ticket, ShieldAlert, CheckSquare, KanbanSquare,
  AlertTriangle, Users, Search, X, ArrowRight, CalendarDays, FolderKanban,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface QuickAction {
  id: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }> | React.ReactNode;
  shortcut?: string;
  href?: string;
  onClick?: () => void;
}

interface QuickActionPaletteProps {
  open?: boolean;
  onClose: () => void;
  onSelectAction?: (actionId: string) => void;
  // Accepts the role-filtered actions supplied by the dashboard layout.
  isOpen?: boolean;
  actions?: any[];
}

const DEFAULT_ACTIONS: QuickAction[] = [
  {
    id: 'create-ticket',
    title: 'Create New Ticket',
    desc: 'Report issue, request, or task',
    icon: Ticket,
    shortcut: 'CMD + N',
    href: '/tickets/new',
  },
  {
    id: 'risks',
    title: 'Review Delivery Risks',
    desc: 'Clear blockers affecting today\'s work',
    icon: AlertTriangle,
    shortcut: 'CMD + R',
    href: '/tickets?priority=HIGH',
  },
  {
    id: 'kanban',
    title: 'Open Kanban Board',
    desc: 'Visualize your team\'s workflow',
    icon: KanbanSquare,
    shortcut: 'CMD + K',
    href: '/kanban',
  },
  {
    id: 'high-priority',
    title: 'Review High Priority',
    desc: 'Audit urgent tickets approaching SLA limits',
    icon: ShieldAlert,
    shortcut: 'CMD + H',
    href: '/tickets?priority=URGENT',
  },
  {
    id: 'projects',
    title: 'Open Projects',
    desc: 'Evaluate dashboard releases and streams',
    icon: FolderKanban,
    shortcut: 'CMD + P',
    href: '/projects',
  },
  {
    id: 'team',
    title: 'Check Team Availability',
    desc: 'Look at active roster and presence status',
    icon: Users,
    shortcut: 'CMD + A',
    href: '/team',
  },
  {
    id: 'leaves',
    title: 'Review Leave Requests',
    desc: 'Manage pending absence and medical requests',
    icon: CalendarDays,
    shortcut: 'CMD + L',
    href: '/leave',
  },
  {
    id: 'my-tickets',
    title: 'My Tickets',
    desc: 'View all tickets assigned to you',
    icon: CheckSquare,
    shortcut: 'CMD + T',
    href: '/tickets',
  },
];

export function QuickActionPalette({
  open,
  onClose,
  onSelectAction,
  isOpen,
  actions,
}: QuickActionPaletteProps) {
  const isVisible = open ?? isOpen ?? false;

  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isVisible) {
      setSearchQuery('');
      setFocusedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isVisible]);

  const sourceActions: QuickAction[] = actions?.length
    ? actions.map((action, index) => ({
      id: action.id ?? action.href ?? `action-${index}`,
      title: action.title ?? action.label ?? 'Action',
      desc: action.desc ?? action.description ?? '',
      icon: action.icon ?? ArrowRight,
      shortcut: action.shortcut,
      href: action.href,
      onClick: action.onClick,
    }))
    : DEFAULT_ACTIONS;

  const filteredActions = sourceActions.filter(
    (act) =>
      act.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      act.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const triggerAction = useCallback((action: QuickAction) => {
    onSelectAction?.(action.id);
    if (action.onClick) {
      action.onClick();
    } else if (action.href) {
      // Use window.location for navigation to avoid needing useRouter here
      window.location.href = action.href;
    }
    onClose();
  }, [onClose, onSelectAction]);

  // Keyboard navigation & Esc support
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % filteredActions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + filteredActions.length) % filteredActions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredActions[focusedIndex]) {
          triggerAction(filteredActions[focusedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, focusedIndex, filteredActions, onClose, triggerAction]);

  const renderIcon = (icon: QuickAction['icon']) => {
    if (React.isValidElement(icon)) {
      return icon;
    }
    if (typeof icon === 'function') {
      const Icon = icon;
      return <Icon className="w-4 h-4 shrink-0" />;
    }
    return <ArrowRight className="w-4 h-4 shrink-0" />;
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-10 select-none">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#0B1220]/65 backdrop-blur-md cursor-pointer"
          />

          {/* Palette Box Wrapper */}
          <motion.div
            ref={paletteRef}
            initial={{ opacity: 0, scale: 0.96, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative bg-[#0B1220] border border-blue-900/40 text-white w-full max-w-xl rounded-[24px] shadow-[0_24px_60px_rgba(11,18,32,0.5)] overflow-hidden flex flex-col z-10 mt-10 max-h-[85vh]"
          >
            {/* Header / Config Bar */}
            <div className="p-4 bg-[#090e1a] border-b border-blue-950 flex items-center justify-between">
              <span className="text-[10px] font-mono font-black text-blue-400 tracking-widest uppercase">
                Quick Actions — Operations Directory
              </span>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Bar */}
            <div className="p-4 bg-slate-900/30 relative flex items-center border-b border-blue-950/30">
              <Search className="w-4 h-4 text-slate-400 absolute left-8 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFocusedIndex(0);
                }}
                placeholder="Search operations directory (e.g. ticket, roster)..."
                className="w-full pl-10 pr-4 py-2.5 bg-[#090e1a]/90 text-xs font-semibold rounded-xl border border-blue-900/30 focus:outline-none focus:border-blue-500 font-sans text-slate-100 placeholder-slate-500"
              />
            </div>

            {/* Rows Actions */}
            <div className="p-2 overflow-y-auto max-h-[380px] space-y-1">
              {filteredActions.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  <p className="text-xs font-semibold">No commands match your query.</p>
                </div>
              ) : (
                filteredActions.map((action, index) => {
                  const isFocused = index === focusedIndex;
                  return (
                    <button
                      key={action.id}
                      onClick={() => triggerAction(action)}
                      onMouseEnter={() => setFocusedIndex(index)}
                      className={`w-full text-left p-3.5 rounded-xl flex items-center justify-between transition-all duration-200 cursor-pointer select-none border ${
                        isFocused
                          ? 'bg-blue-600 border-transparent shadow-[0_4px_16px_rgba(37,99,235,0.22)] text-white scale-[1.01]'
                          : 'bg-slate-900/60 text-slate-100 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 truncate">
                        {/* Icon Blue Chip */}
                        <div className={`p-2 rounded-lg transition-colors ${
                          isFocused ? 'bg-white/20 text-white' : 'bg-blue-950/40 text-blue-400'
                        }`}>
                          {renderIcon(action.icon)}
                        </div>
                        <div className="truncate text-left font-sans">
                          <h4 className={`text-xs font-bold leading-none ${isFocused ? 'text-white' : 'text-slate-100'}`}>
                            {action.title}
                          </h4>
                          <p className={`text-[10px] mt-1 font-semibold leading-normal truncate ${isFocused ? 'text-white/60' : 'text-slate-400'}`}>
                            {action.desc}
                          </p>
                        </div>
                      </div>

                      {/* Arrow indicator */}
                      <div className="flex items-center gap-2 pr-1 shrink-0 select-none font-mono">
                        <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isFocused ? 'text-white translate-x-0.5' : 'text-slate-400'}`} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer instructions */}
            <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex items-center justify-between select-none">
              <span>Use ↑↓ arrows to navigate. Enter to execute bounds</span>
              <span>ESC to exit</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default QuickActionPalette;
