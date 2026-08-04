// Route adapter only. The screen lives in the Sales CRM Leads component and is
// imported through its public entry point — never by internal file path.
//
// Browser route is unchanged: /sales-crm/leads
// Authorization is enforced by the parent layout (ADMIN / SUPER_ADMIN).
import { SalesCrmLeads } from '@apex/sales-crm-leads';

export default function SalesCrmLeadsPage() {
  return <SalesCrmLeads />;
}
