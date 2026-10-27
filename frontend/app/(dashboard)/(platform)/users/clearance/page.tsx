'use client';
// Clearance items the signed-in person owns across open exits.
import { MyClearanceItems } from '@/components/transitions/ExitPanel';

export default function MyClearancePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-semibold">Exit clearance</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Handover, assets, documents and access items assigned to you for colleagues who are leaving.</p>
      </header>
      <MyClearanceItems />
    </div>
  );
}
