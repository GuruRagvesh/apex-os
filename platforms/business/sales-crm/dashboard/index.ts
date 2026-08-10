// Sales CRM — dashboard component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Per D12 dashboard and analytics stay SEPARATE components; neither may reach
// into the other's internals.
//
// CSS is deliberately NOT re-exported here. Stylesheets are published by exact
// path from sales-crm/shared, because routing a CSS module through a JS barrel
// changes its cascade position.

export * from './frontend';
