'use client';

import { useState } from 'react';
import { usersApi } from '@apex/core-users/api';
import toast from 'react-hot-toast';

export type TicketDefaults = { autoAssign: boolean; defaultPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' };
export const DEFAULT_TICKET_DEFAULTS: TicketDefaults = { autoAssign: true, defaultPriority: 'MEDIUM' };

export function readTicketDefaults(value: any): TicketDefaults {
  return {
    autoAssign: typeof value?.autoAssign === 'boolean' ? value.autoAssign : true,
    defaultPriority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(value?.defaultPriority) ? value.defaultPriority : 'MEDIUM',
  };
}

export function TicketDefaultsPanel({ value, onSaved, onClose }: { value: TicketDefaults; onSaved: (value: TicketDefaults) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences(draft);
      onSaved(draft);
      toast.success('Ticket defaults saved');
      onClose();
    } catch (error: any) { toast.error(error?.message || 'Could not save ticket defaults'); }
    finally { setSaving(false); }
  };

  return <section className="apex-card mb-5 space-y-4 p-5" aria-label="My ticket defaults">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>My ticket defaults</h3><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Used for new task rows only; you can still change each ticket.</p></div><button type="button" onClick={onClose} aria-label="Close ticket defaults">×</button></div>
    <label className="flex items-center justify-between gap-4 text-sm" style={{ color: 'var(--text-primary)' }}><span>Assign tasks I create to me when my department is selected</span><input type="checkbox" checked={draft.autoAssign} onChange={(event) => setDraft((current) => ({ ...current, autoAssign: event.target.checked }))} /></label>
    <label className="flex items-center justify-between gap-4 text-sm" style={{ color: 'var(--text-primary)' }}><span>Default priority</span><select className="apex-input max-w-44" value={draft.defaultPriority} onChange={(event) => setDraft((current) => ({ ...current, defaultPriority: event.target.value as TicketDefaults['defaultPriority'] }))}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
    <button type="button" onClick={save} disabled={saving} className="apex-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save ticket defaults'}</button>
  </section>;
}
