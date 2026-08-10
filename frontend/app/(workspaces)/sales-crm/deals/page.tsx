import { Handshake } from 'lucide-react';
import { PlannedPane } from '@apex/sales-crm-shell/components/PlannedPane';

export default function SalesCrmDealsPage() {
  return (
    <PlannedPane
      icon={<Handshake size={22} />}
      title="Deals"
      description="A dedicated deal-tracking view — stage, value, payment status, and win/loss — separate from the lead record it originated from."
      note="Not built yet. Deal data already flows through the Leads and Analytics modules (see a lead's Deals tab, or the Analytics pipeline breakdown); this page will add a focused, filterable deals-only view once the backend is connected."
    />
  );
}
