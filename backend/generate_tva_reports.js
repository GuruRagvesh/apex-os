const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('anomaly_raw.json', 'utf8'));

const anomaliesConfig = [
  {
    id: 'WS_01',
    title: 'Logout Before Start',
    type: 'WorkSession',
    likelyCause: 'Race condition between start work API and logout API, or frontend double submission.',
    severity: 'High',
    repairability: 'MANUAL_REVIEW',
    policyQuestion: 'How should we reconstruct time when logout is before start? Drop the record, or assume 0 duration?'
  },
  {
    id: 'WS_02',
    title: 'Missing Start With Logout (Login Only)',
    type: 'WorkSession',
    likelyCause: 'User logged in but never started work, then logged out. System recorded logout on session.',
    severity: 'Low',
    repairability: 'IGNORE_OR_ARCHIVE',
    policyQuestion: 'Should login-only sessions be preserved for audit purposes or deleted to save space?'
  },
  {
    id: 'WS_03',
    title: 'Active / Open Sessions (Missing Logout)',
    type: 'WorkSession',
    likelyCause: 'User closed browser without logging out, and scheduled auto-close cron failed or was delayed.',
    severity: 'Medium',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'What time should be assigned to missing logouts? (Midnight? End of scheduled shift? Last active ping?)'
  },
  {
    id: 'WS_04',
    title: 'Stale Open Sessions (>12h)',
    type: 'WorkSession',
    likelyCause: 'Scheduler completely missed the session closure for multiple days.',
    severity: 'High',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'Should stale sessions >12h be capped at standard shift duration (e.g., 9 hours) or exactly at midnight?'
  },
  {
    id: 'WS_05',
    title: 'Excessive Work Duration (>10h)',
    type: 'WorkSession',
    likelyCause: 'User actually worked long hours, or forgot to log out and cron closed it very late.',
    severity: 'Low',
    repairability: 'NEEDS_POLICY_DECISION',
    policyQuestion: 'Should durations over 10 hours be capped automatically for payroll, or flagged for manager approval?'
  },
  {
    id: 'WS_06',
    title: 'Extreme Work Duration (>16h)',
    type: 'WorkSession',
    likelyCause: 'Definite system failure to auto-close session at midnight, rolling into next day.',
    severity: 'High',
    repairability: 'NEEDS_POLICY_DECISION',
    policyQuestion: 'Should durations >16h be forcefully clamped to 9 hours or truncated at midnight?'
  },
  {
    id: 'WS_07',
    title: 'Excessive Break Duration (>4h)',
    type: 'WorkSession',
    likelyCause: 'User went on break, forgot to resume, and auto-close eventually stopped the day.',
    severity: 'Medium',
    repairability: 'NEEDS_POLICY_DECISION',
    policyQuestion: 'Should long breaks deduct from productive time, or should the day be considered early-logout?'
  },
  {
    id: 'WS_08',
    title: 'Duplicate Active Sessions',
    type: 'WorkSession',
    likelyCause: 'User logged in from multiple devices/browsers, creating parallel active state rows.',
    severity: 'High',
    repairability: 'MANUAL_REVIEW',
    policyQuestion: 'Which session wins when multiple are active simultaneously? First created or last active?'
  },
  {
    id: 'WS_09',
    title: 'Overlapping Session Windows',
    type: 'WorkSession',
    likelyCause: 'Login/logout boundaries overlap due to multiple devices or manual status override bugs.',
    severity: 'High',
    repairability: 'MANUAL_REVIEW',
    policyQuestion: 'How to merge overlapping sessions? Sum non-overlapping segments or keep the longest?'
  },
  {
    id: 'WS_10',
    title: 'Terminal Status Without Logout Timestamp',
    type: 'WorkSession',
    likelyCause: 'Direct database mutation or early bug where status was set to COMPLETED but logoutAt was not written.',
    severity: 'Low',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'Is it acceptable to set logoutAt = updatedAt for these records?'
  },
  {
    id: 'WS_11',
    title: 'AutoClosed Sessions Missing autoClosedAt',
    type: 'WorkSession',
    likelyCause: 'Scheduler flagged autoClosed=true but failed to record the timestamp of the action.',
    severity: 'Low',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'None. Safe to sync autoClosedAt with logoutAt.'
  },
  {
    id: 'WS_12',
    title: 'Invalid Parent Continuation Session',
    type: 'WorkSession',
    likelyCause: 'Session was marked as a continuation of a session belonging to another user or a deleted session.',
    severity: 'Medium',
    repairability: 'IGNORE_OR_ARCHIVE',
    policyQuestion: 'Should we unlink invalid parent IDs and treat them as standalone sessions?'
  },
  {
    id: 'BL_01',
    title: 'Break Without End Time',
    type: 'BreakLog',
    likelyCause: 'User never clicked resume, session was force-closed without ending the break first.',
    severity: 'Medium',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'Should open breaks be closed at the exact time the parent session was closed?'
  },
  {
    id: 'BL_02',
    title: 'Excessive Break (>4h)',
    type: 'BreakLog',
    likelyCause: 'User forgot to resume from break.',
    severity: 'Medium',
    repairability: 'NEEDS_POLICY_DECISION',
    policyQuestion: 'Similar to WS_07. Cap the break or truncate work day?'
  },
  {
    id: 'BL_03',
    title: 'Break End Before Start',
    type: 'BreakLog',
    likelyCause: 'Race condition in break/resume API.',
    severity: 'High',
    repairability: 'MANUAL_REVIEW',
    policyQuestion: 'Assume 0 duration or delete the break record?'
  },
  {
    id: 'BL_04',
    title: 'Break Outside Parent Session Window',
    type: 'BreakLog',
    likelyCause: 'Break started before work started, or ended after session was closed (timezone issues/direct writes).',
    severity: 'High',
    repairability: 'AUTO_REPAIRABLE',
    policyQuestion: 'Clamp break start/end to strictly fit within parent session start/logout?'
  },
  {
    id: 'BL_05',
    title: 'Orphaned Break (Invalid/Missing Parent Session)',
    type: 'BreakLog',
    likelyCause: 'Parent WorkSession was hard-deleted, but BreakLogs were not cascaded.',
    severity: 'Low',
    repairability: 'IGNORE_OR_ARCHIVE',
    policyQuestion: 'Should orphaned break logs be hard deleted?'
  }
];

let classMd = `# FP20C_HISTORICAL_CLASSIFICATION\n\n`;
let tableMd = `# FP20C_ANOMALY_TABLE\n\n| ID | Category | Type | Count | Severity | Repairability |\n|---|---|---|---|---|---|\n`;
let policyMd = `# FP20C_REPAIR_POLICY_QUESTIONS\n\n`;
let dryRunMd = `# FP20C_DRY_RUN_REPAIR_PLAN\n\n## Auto-Repair Execution Plan\n\n`;

for (const cfg of anomaliesConfig) {
  const data = raw[cfg.id] || { count: 0, users: [], dates: [], samples: [] };
  
  // Table
  tableMd += `| ${cfg.id} | ${cfg.title} | ${cfg.type} | ${data.count} | ${cfg.severity} | ${cfg.repairability} |\n`;
  
  // Classification
  classMd += `### ${cfg.id} - ${cfg.title}\n\n`;
  classMd += `- **Type:** ${cfg.type}\n`;
  classMd += `- **Count:** ${data.count}\n`;
  classMd += `- **Affected Users:** ${data.users.length > 0 ? data.users.length + ' users' : 'None'}\n`;
  classMd += `- **Affected Date Range:** ${data.dates.length > 0 ? data.dates.length + ' dates' : 'None'}\n`;
  classMd += `- **Severity:** ${cfg.severity}\n`;
  classMd += `- **Repairability:** ${cfg.repairability}\n`;
  classMd += `- **Likely Cause:** ${cfg.likelyCause}\n`;
  classMd += `- **Recommended Action:** ${cfg.repairability === 'AUTO_REPAIRABLE' ? 'Run deterministic auto-repair script.' : cfg.repairability === 'MANUAL_REVIEW' ? 'Export records to CSV for HR/Manager manual sign-off.' : cfg.repairability === 'IGNORE_OR_ARCHIVE' ? 'Leave as-is or move to cold storage.' : 'Await policy decision.'}\n`;
  classMd += `- **Requires Policy Decision:** ${cfg.policyQuestion !== 'None' ? 'Yes' : 'No'}\n\n`;
  
  if (data.samples && data.samples.length > 0) {
    classMd += `**Sample Rows:**\n\`\`\`json\n${JSON.stringify(data.samples.map(s => s.id || (s.s1 && s.s1.id)), null, 2)}\n\`\`\`\n\n`;
  }
  
  // Policy Questions
  if (cfg.policyQuestion !== 'None' && cfg.repairability === 'NEEDS_POLICY_DECISION' || cfg.repairability === 'MANUAL_REVIEW') {
    policyMd += `### ${cfg.id} - ${cfg.title}\n**Question:** ${cfg.policyQuestion}\n**Affected Records:** ${data.count}\n\n`;
  }

  // Dry Run Plan
  if (cfg.repairability === 'AUTO_REPAIRABLE' && data.count > 0) {
    dryRunMd += `### ${cfg.id} - ${cfg.title}\n- **Action:** Deterministic repair rule implementation.\n- **Target Records:** ${data.count}\n- **Rollback Plan:** Take DB snapshot before execution.\n\n`;
  }
}

classMd += `
## Final Verdict

1. **Can historical dashboard reports be trusted?**
   No. The presence of overlapping sessions, 16h+ durations, and negative durations mean historical metrics are skewed.
2. **Can current-day runtime be trusted after FP-20B?**
   Yes. FP-20B properly centralized time boundaries and attendance mutations. New data will not suffer from these anomalies.
3. **Which anomaly classes can be safely auto-repaired later?**
   Missing logouts (via midnight caps), terminal statuses missing timestamps, open breaks inside closed sessions.
4. **Which anomaly classes need manual review?**
   Overlapping sessions, negative durations (logout < start), and extremely long breaks/work days.
5. **What policy decisions are required before repair?**
   How to cap long durations (midnight vs. fixed shift hours), whether to retain login-only non-work sessions, and how to merge overlapping sessions.
6. **Is Apex OS still a Controlled Rollout Candidate?**
   Yes. The runtime is stable. The historical data anomalies only affect retroactive reporting, not current operational use.
`;

fs.writeFileSync('../FP20C_HISTORICAL_CLASSIFICATION.md', classMd);
fs.writeFileSync('../FP20C_ANOMALY_TABLE.md', tableMd);
fs.writeFileSync('../FP20C_REPAIR_POLICY_QUESTIONS.md', policyMd);
fs.writeFileSync('../FP20C_DRY_RUN_REPAIR_PLAN.md', dryRunMd);

console.log("Reports generated successfully.");
