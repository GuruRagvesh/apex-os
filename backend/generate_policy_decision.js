const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('anomaly_raw.json', 'utf8'));

const decisions = [
  {
    id: 'WS_01',
    title: 'Logout Before Start',
    classification: 'EXCLUDE_FROM_REPORTING',
    rule: 'Flag record as INVALID_TIME_BOUNDS. Do not delete, but exclude from all analytics and SLA queries.',
  },
  {
    id: 'WS_02',
    title: 'Missing Start With Logout (Login Only)',
    classification: 'DO_NOT_TOUCH',
    rule: 'These contribute 0 productive minutes. Leave as audit logs for system access.',
  },
  {
    id: 'WS_03',
    title: 'Active / Open Sessions (Missing Logout)',
    classification: 'AUTO_REPAIR',
    rule: 'Missing logout where a clear same-day company cutoff applies and no conflicting next session exists. Set logoutAt to company policy cutoff. Set status to AUTO_CLOSED.',
  },
  {
    id: 'WS_04',
    title: 'Stale Open Sessions (>12h)',
    classification: 'AUTO_REPAIR',
    rule: 'Stale open session where policy cutoff is deterministic and no overlapping valid session exists. Set logoutAt to policy cutoff.',
  },
  {
    id: 'WS_05',
    title: 'Excessive Work Duration (>10h)',
    classification: 'MANUAL_REVIEW',
    rule: 'Flag for manager timesheet review. User might have genuinely worked overtime.',
  },
  {
    id: 'WS_06',
    title: 'Extreme Work Duration (>16h)',
    classification: 'MANUAL_REVIEW',
    rule: 'Extreme duration alone does not prove the correct logout time. It may be valid overtime, stale open session, overlapping session, or missing end-day. Do not mutate these blindly.',
  },
  {
    id: 'WS_07',
    title: 'Excessive Break Duration (>4h)',
    classification: 'MANUAL_REVIEW',
    rule: 'Flag for manager review. Too ambiguous to automatically dock pay or auto-logout.',
  },
  {
    id: 'WS_08',
    title: 'Duplicate Active Sessions',
    classification: 'MANUAL_REVIEW',
    rule: 'Cannot safely merge. Export to CSV for manual timesheet correction.',
  },
  {
    id: 'WS_09',
    title: 'Overlapping Session Windows',
    classification: 'EXCLUDE_FROM_REPORTING',
    rule: 'Mark as OVERLAPPING_CONFLICT. Exclude from productive time calculations to prevent double-counting.',
  },
  {
    id: 'WS_10',
    title: 'Terminal Status Without Logout Timestamp',
    classification: 'AUTO_REPAIR',
    rule: 'Set logoutAt = updatedAt. Since status is already terminal, we sync the time bound.',
  },
  {
    id: 'WS_11',
    title: 'AutoClosed Sessions Missing autoClosedAt',
    classification: 'AUTO_REPAIR',
    rule: 'Set autoClosedAt = updatedAt. Ensures SLA/Analytics filters do not crash on null timestamps.',
  },
  {
    id: 'WS_12',
    title: 'Invalid Parent Continuation Session',
    classification: 'AUTO_REPAIR',
    rule: 'Set continuationOfSessionId = null. Treat as standalone session.',
  },
  {
    id: 'BL_01',
    title: 'Break Without End Time',
    classification: 'AUTO_REPAIR',
    rule: 'Open break inside already closed parent session. Close break at parent logoutAt.',
  },
  {
    id: 'BL_02',
    title: 'Excessive Break (>4h)',
    classification: 'MANUAL_REVIEW',
    rule: 'Same as WS_07. Flag for manager review.',
  },
  {
    id: 'BL_03',
    title: 'Break End Before Start',
    classification: 'EXCLUDE_FROM_REPORTING',
    rule: 'Flag record as INVALID_TIME_BOUNDS. Do not delete, but exclude from analytics.',
  },
  {
    id: 'BL_04',
    title: 'Break Outside Parent Session Window',
    classification: 'AUTO_REPAIR',
    rule: 'Clamp break to parent bounds only if parent session bounds are valid and non-overlapping.',
  },
  {
    id: 'BL_05',
    title: 'Orphaned Break (Invalid/Missing Parent Session)',
    classification: 'EXCLUDE_FROM_REPORTING',
    rule: 'Flag as ORPHAN. Exclude from calculations.',
  }
];

let md = `# FP20C_REPAIR_POLICY_DECISION

## Overview
This document outlines the final, proposed rules for how historical Workday data anomalies will be handled during the repair phase.

## Policy Rules per Category
`;

let dryRunMd = `# FP20C_DRY_RUN_REPAIR_PLAN

## Auto-Repair Execution Plan

This dry-run outlines the specific mutations that will occur on the database.

`;

let summary = `## Dry-Run Repair Impact Summary

| Classification | Affected Records | Action Definition |
|---|---|---|
`;

let impactCounts = {
  AUTO_REPAIR: 0,
  MANUAL_REVIEW: 0,
  EXCLUDE_FROM_REPORTING: 0,
  DO_NOT_TOUCH: 0
};

for (const d of decisions) {
  const data = raw[d.id] || { count: 0 };
  const count = data.count || 0;
  
  impactCounts[d.classification] += count;

  md += `### ${d.id}: ${d.title}\n`;
  md += `- **Classification:** \`${d.classification}\`\n`;
  md += `- **Records Affected:** ${count}\n`;
  md += `- **Rule:** ${d.rule}\n\n`;

  if (d.classification === 'AUTO_REPAIR' && count > 0) {
    dryRunMd += `### ${d.id} - ${d.title}\n`;
    dryRunMd += `- **Action:** ${d.rule}\n`;
    dryRunMd += `- **Target Records:** ${count}\n`;
    dryRunMd += `- **Rollback Plan:** Take DB snapshot before execution.\n\n`;
  }
}

summary += `| \`AUTO_REPAIR\` | ${impactCounts.AUTO_REPAIR} rows | Will be deterministically mutated via Prisma update. |\n`;
summary += `| \`MANUAL_REVIEW\` | ${impactCounts.MANUAL_REVIEW} rows | Will be flagged and exported to CSV for management. |\n`;
summary += `| \`EXCLUDE_FROM_REPORTING\` | ${impactCounts.EXCLUDE_FROM_REPORTING} rows | Will be flagged as invalid via metadata/status without deletion. |\n`;
summary += `| \`DO_NOT_TOUCH\` | ${impactCounts.DO_NOT_TOUCH} rows | Will be ignored completely during repair script execution. |\n`;

md += summary;
dryRunMd += summary;

fs.writeFileSync('../FP20C_REPAIR_POLICY_DECISION.md', md);
fs.writeFileSync('../FP20C_DRY_RUN_REPAIR_PLAN.md', dryRunMd);
console.log('Policy decision document created.');
