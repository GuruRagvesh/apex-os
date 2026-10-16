// shared/remediation — public entry point.
//
// Exports the framework-free contract, the dialog and the hook. It does NOT
// export ./frontend/remediation-api: the HTTP clients are published separately
// as '@apex/shared-remediation/api', so this barrel's import graph never
// reaches axios or the authenticated client.

export * from './shared/remediation-contract';
export { RemediationDialog } from './frontend/RemediationDialog';
export type { RemediationDialogProps } from './frontend/RemediationDialog';
export { useRemediation } from './frontend/useRemediation';
