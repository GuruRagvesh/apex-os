import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const detailPath = path.join(root, 'frontend/components/attendance-v2/DayDetailDrawer.tsx');
const shellPath = path.join(root, 'frontend/components/attendance/AttendanceDrawer.tsx');
const stylesPath = path.join(root, 'frontend/components/attendance-v2/visual-fidelity.module.css');

const detail = fs.readFileSync(detailPath, 'utf8');
const shell = fs.readFileSync(shellPath, 'utf8');
const styles = fs.readFileSync(stylesPath, 'utf8');

const checks = [
  ['sessions are not hardcoded when the API has no session count', !detail.includes('label="Sessions"')],
  ['deficiency is not hardcoded when the API has no deficiency field', !detail.includes('label="Deficiency"')],
  ['unknown break is described as not recorded', detail.includes("? 'Not recorded'")],
  ['evidence, activity and policy are collapsible', ['Evidence', 'Workday Activity', 'Policy & Evaluation'].every((title) => detail.includes(`title="${title}"`))],
  ['photo evidence remains on demand', detail.includes('showPhoto') && detail.includes('setShowPhoto(true)')],
  ['correction action remains available and sticky', detail.includes('onRequestCorrection(date)') && styles.includes('position: sticky')],
  ['drawer traps focus and restores page focus', shell.includes("e.key !== 'Tab'") && shell.includes('previousFocus?.focus()')],
  ['drawer closes with Escape', shell.includes("e.key === 'Escape'")],
  ['mobile evidence uses one column', styles.includes('.evidenceGrid') && styles.includes('grid-template-columns: 1fr;')],
  ['reduced motion removes disclosure animation', styles.includes('@media(prefers-reduced-motion:reduce)') && styles.includes('.disclosureMeta>svg')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);

if (failed.length) {
  console.error(`\n${failed.length} attendance drawer check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} attendance drawer checks passed.`);
