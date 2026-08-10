import { ClipboardList } from 'lucide-react';
import { PlannedPane } from '@apex/sales-crm-shell';

export default function SalesCrmRequirementsSourcingPage() {
  return (
    <PlannedPane
      icon={<ClipboardList size={22} />}
      title="Requirements & Sourcing"
      description="Capture client requirements once a lead reaches the requirements stage, and track sourcing/fulfillment progress against them."
      note="Not built yet. Requirement records already flow through the Leads module (see a lead's Requirements tab); this page will add a dedicated cross-lead requirements and sourcing workflow once the backend is connected."
    />
  );
}
