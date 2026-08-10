// Sales CRM — analytics component public entry point.
//
// Per D12 analytics and dashboard stay SEPARATE components; neither reaches
// into the other's internals. Stylesheets are never re-exported here: the
// component-owned analytics.module.css is imported by relative path from its
// siblings, and shared stylesheets arrive by exact path from sales-crm/shared.

export * from './frontend';
