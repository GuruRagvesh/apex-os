import { SalesCrmDashboard } from '@apex/sales-crm-dashboard';

// /sales-crm is the main landing page for the workspace — it renders the
// same dashboard as /sales-crm/dashboard (see instruction: "/sales-crm/dashboard
// may either render the same dashboard component or redirect/link to the
// same dashboard UI"). Auth gating and shell chrome live in layout.tsx.
export default function SalesCrmPage() {
  return <SalesCrmDashboard />;
}
