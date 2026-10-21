import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const screenPath = path.join(root, 'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx');
const compOffPath = path.join(root, 'platforms/workforce/leave/applications/frontend/components/CompOffGrantPanel.tsx');
const presentationPath = path.join(root, 'platforms/workforce/leave/applications/frontend/lib/leave-presentation.ts');

const screen = fs.readFileSync(screenPath, 'utf8');
const compOff = fs.readFileSync(compOffPath, 'utf8');
const presentation = fs.readFileSync(presentationPath, 'utf8');

const checks = [
  ['statistics do not use false-zero fallbacks', !/stats\?\.(total|pending|approved|rejected)\s*\|\|\s*0/.test(screen)],
  ['duration failures do not become zero', !/catch\([^)]*\)\s*=>\s*setFormDuration\(0\)/.test(screen)],
  ['request cache is scoped by user and role', /queryKey:\s*\['leave',\s*'requests',\s*user\?\.id[^\]]*_roleName/.test(screen)],
  ['summary error explicitly distinguishes unknown from zero', screen.includes('they are not zero counts')],
  ['balance errors explicitly distinguish unknown from zero', screen.includes('Your balance has not been treated as zero')],
  ['request retry exposes active feedback', screen.includes("isFetching ? 'Retrying…' : 'Retry'")],
  ['grant comp off is opened contextually', screen.includes('setShowCompOff(true)') && screen.includes('labelledBy="grant-comp-off-title"')],
  ['leave dialogs trap focus and close with Escape', screen.includes("event.key === 'Escape'") && screen.includes("event.key !== 'Tab'")],
  ['comp-off employee credits have loading and error states', compOff.includes('existingLoading') && compOff.includes('existingFailed')],
  ['employee directory has loading and error states', compOff.includes('directoryLoading') && compOff.includes('directoryFailed')],
  ['error presentation covers auth, permission, server and network cases', ['authentication', 'permission', 'server', 'unavailable'].every((kind) => presentation.includes(`kind: '${kind}'`))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);

if (failed.length) {
  console.error(`\n${failed.length} leave reliability check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} leave reliability checks passed.`);
