// Sales CRM — shell frontend surface.
//
// SalesCrmShell composes Sidebar and Topbar, which stay internal. PlannedPane
// is published because two placeholder routes render it directly. Note the two
// differ in export shape and each is re-exported as it was declared.

export { default as SalesCrmShell } from './components/SalesCrmShell';
export { PlannedPane } from './components/PlannedPane';
