// Sales CRM — shell frontend surface.
//
// SalesCrmShell composes Sidebar and Topbar, which stay internal.
//
// PlannedPane is deliberately NOT re-exported here. Two placeholder routes
// render it and nothing else; pulling it through this barrel also pulled
// SalesCrmShell, Sidebar, Topbar and motion/react into them, costing +26 kB of
// First Load JS each. It is published as an exact subpath instead.

export { default as SalesCrmShell } from './components/SalesCrmShell';
