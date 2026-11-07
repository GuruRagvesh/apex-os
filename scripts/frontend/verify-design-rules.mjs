#!/usr/bin/env node
/**
 * Apex OS — DESIGN.md rule checker (warn-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * DESIGN.md fixes the type scale, colour families, icon sizes and title style so
 * that a new feature matches the rest of the app without a later UI pass. Old
 * pages still break some rules and are being moved over gradually, so this
 * checker only looks at files changed against the base branch (or the files
 * passed as arguments) and reports what it finds. It never fails the build.
 *
 * Usage:
 *   node scripts/frontend/verify-design-rules.mjs            # changed vs origin/main
 *   node scripts/frontend/verify-design-rules.mjs --base=staging
 *   node scripts/frontend/verify-design-rules.mjs path/to/File.tsx ...
 *   node scripts/frontend/verify-design-rules.mjs --all      # whole frontend
 *
 * Node built-ins only. Reads files, touches nothing else. Exit code is always 0.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN_DIRS = ['frontend/app', 'frontend/components', 'platforms', 'shared', 'apps'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build']);

const RULES = [
  {
    id: 'tiny-text',
    test: /(?<![\w-])text-\[(?:[0-9]|10)(?:\.\d+)?px\]|fontSize:\s*['"]?(?:[0-9]|10)(?:\.\d+)?(?:px)?['"]?\s*[,}]|font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/,
    hint: 'text below 11px. Use text-caption (11px) or a step of the type scale.',
  },
  {
    id: 'arbitrary-text-size',
    test: /(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem)\]/,
    hint: 'arbitrary text size. Use the scale: caption, xs, sm, base, lg, xl, 2xl, 3xl.',
  },
  {
    id: 'hex-colour',
    test: /['"`(:\s]#[0-9a-fA-F]{6}\b|['"`(:\s]#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/,
    hint: 'hard-coded colour. Use a token: var(--text-primary), var(--success-text), bg-apex-card ...',
  },
  {
    id: 'off-family-colour',
    test: /(?<![\w-])(?:bg|text|border|ring|from|via|to)-(?:gray|zinc|neutral|stone|green|teal|lime|rose|pink|fuchsia|orange|yellow|sky|cyan|indigo|purple)-\d{2,3}\b/,
    hint: 'colour family outside the six (slate, blue, emerald, amber, red, violet), or prefer meaning tokens like text-success-text.',
  },
  {
    id: 'heavy-weight',
    test: /\bfont-(?:extrabold|black)\b|fontWeight:\s*['"]?(?:800|900)\b/,
    hint: 'weights are 400/500/600/700 only.',
  },
  {
    id: 'icon-size',
    test: /<[A-Z][A-Za-z0-9.]*\b[^<>]*?\bsize=\{(?:11|13|15|17|18|19|22)\}/,
    hint: 'icon size outside 12/14/16/20/24.',
  },
  {
    id: 'decorative-gradient',
    test: /\b(?:from|via|to)-(?:purple|indigo|violet|pink|fuchsia)-\d{2,3}\b|bg-clip-text/,
    hint: 'decorative purple/pink gradient or gradient text (DESIGN.md → Craft).',
  },
  {
    id: 'emoji',
    test: /\p{Extended_Pictographic}/u,
    hint: 'emoji in UI code. Use a lucide icon.',
  },
  {
    id: 'uppercase-title',
    test: /<h[12][^>]*className="[^"]*\buppercase\b/,
    hint: 'page and section titles are normal case. Uppercase is only for .apex-eyebrow labels.',
  },
  {
    id: 'side-stripe',
    test: /(?<![\w-])border-l-(?:[2-8]|\[\d+px\])\b|borderLeft:\s*['"`]\s*[2-9]px solid/,
    hint: 'coloured side stripe on a card. Use a dot or chip; stripes only for the active nav item or a real alert (Colour policy).',
  },
  {
    id: 'accent-as-text',
    test: /(?:^|[\s;{'"])color:\s*['"]?var\(--accent\)|text-\[var\(--accent\)\]/,
    hint: 'accent used for words. Use var(--accent-text) so it stays readable in dark mode.',
  },
  {
    id: 'tinted-surface',
    test: /(?<![\w:-])bg-(?:emerald|green|teal|amber|yellow|orange|red|rose|pink|violet|purple|indigo|sky|cyan)-50\b/,
    hint: 'tinted card or row background. Keep surfaces neutral; show status with a dot or chip (Colour policy).',
  },
];

// CSS modules that hard-code light colours must also carry dark values.
const HEX = /#[0-9a-fA-F]{3,6}\b/;
function missingDarkTheme(file, text) {
  return file.endsWith('.module.css') && HEX.test(text) && !text.includes('john-wick-dark')
    && !text.includes('design-rules: single-theme');
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|css)$/.test(name)) out.push(p);
  }
}

function changedFiles(base) {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
  };
  const tracked = run(`git diff --name-only ${base}...HEAD`) + run('git diff --name-only HEAD');
  const untracked = run('git ls-files --others --exclude-standard');
  return [...new Set((tracked + untracked).split(/\r?\n/).filter(Boolean))]
    .filter((f) => /\.(tsx|css)$/.test(f) && SCAN_DIRS.some((d) => f.startsWith(d)))
    .map((f) => join(ROOT, f))
    .filter((f) => existsSync(f));
}

const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.slice(7) : 'origin/main';
const explicit = args.filter((a) => !a.startsWith('--'));
let files;
if (args.includes('--all')) {
  files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
} else if (explicit.length) {
  files = explicit.map((f) => join(ROOT, f));
} else {
  files = changedFiles(base);
}

const counts = Object.fromEntries(RULES.map((r) => [r.id, 0]));
counts['no-dark-theme'] = 0;
let total = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (missingDarkTheme(file, text)) {
    counts['no-dark-theme'] += 1;
    total += 1;
    if (!args.includes('--summary')) {
      console.log(`warn  ${relative(ROOT, file)}  [no-dark-theme] literal colours but no john-wick-dark rules; it will show light boxes in dark mode (DESIGN.md → Dark theme in feature CSS).`);
    }
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/design-rules-ignore/.test(line)) return;
    for (const rule of RULES) {
      if (file.endsWith('.css') && !['tiny-text', 'heavy-weight', 'emoji'].includes(rule.id)) continue;
      if (rule.test.test(line)) {
        counts[rule.id] += 1;
        total += 1;
        if (!args.includes('--summary')) {
          console.log(`warn  ${relative(ROOT, file)}:${i + 1}  [${rule.id}] ${rule.hint}`);
        }
      }
    }
  });
}

console.log(`\nDESIGN.md check: ${files.length} file(s), ${total} warning(s).`);
for (const [id, n] of Object.entries(counts)) if (n) console.log(`  ${id.padEnd(22)} ${n}`);
if (total) console.log('Warnings only. Fix them in files you touch; see DESIGN.md.');
process.exit(0);
