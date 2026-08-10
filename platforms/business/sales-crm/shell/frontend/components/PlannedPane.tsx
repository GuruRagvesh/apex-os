'use client';

import { motion } from 'motion/react';

// Reuses the exact placeholder visual pattern already shipped on the
// existing /sales-crm workspace page (frontend/app/(workspaces)/sales-crm/page.tsx's
// PlannedPane), not the intern source's placeholder-page CSS, per the
// containment instructions.
//
// `icon` takes an already-rendered element (e.g. <Handshake size={22} />),
// not a component reference — the callers are Server Component page.tsx
// files, and a bare component reference can't cross the Server->Client
// props boundary into this 'use client' component (it fails static
// generation with "Functions cannot be passed directly to Client
// Components"). A rendered element serializes fine.
export function PlannedPane({ icon, title, description, note }: { icon: React.ReactNode; title: string; description: string; note: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl overflow-hidden border p-8"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start gap-4 mb-5">
        <div className="p-3 rounded-xl flex-shrink-0" style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--color-text-secondary)' }}>
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {title}
            </h2>
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--color-text-secondary)' }}
            >
              Launching Soon
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {description}
          </p>
        </div>
      </div>
      <div className="pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {note}
        </p>
      </div>
    </motion.div>
  );
}
