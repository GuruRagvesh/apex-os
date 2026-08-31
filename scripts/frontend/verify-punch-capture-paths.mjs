#!/usr/bin/env node
/**
 * Apex OS — punch capture paths verifier (PE-5).
 *
 * WHY THIS EXISTS
 * ---------------
 * Production acceptance broke the QR fallback in two ways, and NOTHING in this
 * repo caught either. Both were invisible to typecheck, to the production
 * build, and to every existing guard:
 *
 *   1. The phone page read `params` with React's `use()`. @types/react 18.3.x
 *      DECLARES `use`, so tsc was happy — but the installed React 18.3.1 does
 *      not EXPORT it, so the page threw `use is not a function` on its first
 *      render and shipped as "Application error: a client-side exception".
 *      Types and runtime disagreed, and the types won the argument.
 *
 *   2. The QR was written out twice, in two separate `phase === ...` branches,
 *      so changing phase unmounted one and mounted the other — cancelling the
 *      live handoff and creating a replacement. With an unmemoised
 *      `onCompleted` in the effect's dependencies, every parent re-render did
 *      the same thing.
 *
 * Eight rules. Node built-ins only; reads files, touches nothing else.
 * Exit 0 = all eight hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  modal: 'frontend/components/attendance/PunchModal.tsx',
  qr: 'frontend/components/attendance/PunchHandoffQr.tsx',
  mobile: 'frontend/app/attendance/mobile-punch/[handoffId]/page.tsx',
  api: 'frontend/components/attendance/handoff-api.ts',
  token: 'frontend/components/attendance/handoff-token.ts',
  failure: 'frontend/components/attendance/handoff-failure.ts',
};

const failures = [];

function read(key) {
  const path = resolve(REPO_ROOT, FILES[key]);
  if (!existsSync(path)) {
    failures.push(`Missing ${FILES[key]}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

/** Prose describing a rule must never be read as a breach of it. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\/.*$/gm, '');

const modal = read('modal');
const qr = read('qr');
const mobile = read('mobile');
const api = read('api');
const token = read('token');
const failure = read('failure');

const modalCode = stripComments(modal);
const qrCode = stripComments(qr);
const mobileCode = stripComments(mobile);

// ── Rule 1: React's use() is not available in this runtime ──────────────────
// The single highest-value rule here. React 18.3.1 does not export `use`, but
// the installed types declare it, so this compiles and then crashes.
// React is hoisted to the workspace root, not frontend/node_modules. Both are
// checked, and failing to find it is a FAILURE rather than a silent skip --
// this rule going quiet is indistinguishable from it passing, and it is the
// rule that would have caught the production crash.
const reactVersion = (() => {
  for (const p of ['node_modules/react/package.json', 'frontend/node_modules/react/package.json']) {
    try {
      return JSON.parse(readFileSync(resolve(REPO_ROOT, p), 'utf8')).version;
    } catch {
      /* try the next location */
    }
  }
  return null;
})();

if (!reactVersion) {
  failures.push(
    'Could not locate the installed react package, so the use() rule could not run. Install ' +
      'dependencies before trusting this guard.',
  );
}

if (reactVersion && reactVersion.startsWith('18.')) {
  const appDirs = ['frontend/app', 'frontend/components', 'platforms'];
  const offenders = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(entry)) continue;

      const src = readFileSync(full, 'utf8');
      // `use` imported from react, in any of the shapes an import can take.
      const importsUse =
        /import\s*\{[^}]*\buse\b[^}]*\}\s*from\s*['"]react['"]/.test(src) ||
        /\bReact\.use\s*\(/.test(src);
      if (importsUse) offenders.push(full.replace(REPO_ROOT, '').replace(/\\/g, '/'));
    }
  };

  for (const d of appDirs) walk(resolve(REPO_ROOT, d));

  for (const f of offenders) {
    failures.push(
      `${f} imports React's use(). React ${reactVersion} does not export it — @types/react ` +
        'declares it, so this typechecks and then throws at runtime.',
    );
  }
}

// ── Rule 2: the phone page does not treat params as a promise ───────────────
if (/params\s*:\s*Promise\s*</.test(mobileCode)) {
  failures.push(
    'The mobile punch page types params as a Promise. On Next 14 it is a plain object, and ' +
      'awaiting it needs a React that provides use().',
  );
}

// ── Rule 3: exactly one QR in the modal ─────────────────────────────────────
const qrMounts = (modalCode.match(/<PunchHandoffQr\b/g) ?? []).length;
if (qrMounts === 0) {
  failures.push('PunchModal does not offer the phone route at all.');
} else if (qrMounts > 1) {
  failures.push(
    `PunchModal mounts <PunchHandoffQr> ${qrMounts} times. Two mounts in two phase branches means ` +
      'React unmounts one and mounts the other on every phase change, cancelling the live handoff ' +
      'and creating a replacement. Mount it once, outside the phase conditionals.',
  );
}

// ── Rule 4: the handoff effect does not depend on a callback prop ───────────
// `onCompleted` is passed as an inline arrow from WorkdayBar, so its identity
// changes on every parent render. In a dependency array that is a create/cancel
// storm.
// Only the effect that CREATES the handoff matters. A one-line ref-sync effect
// depending on the callback is the correct pattern and must not be flagged.
const createAt = qrCode.indexOf('createHandoff(');
if (createAt === -1) {
  failures.push('PunchHandoffQr no longer creates a handoff.');
} else {
  const afterCreate = qrCode.slice(createAt);
  const depsMatch = /\}\s*,\s*\[([^\]]*)\]\s*\)/.exec(afterCreate);
  const deps = depsMatch ? depsMatch[1] : null;

  if (deps === null) {
    failures.push('Could not read the dependency array of the handoff-creating effect.');
  } else if (/\bonCompleted\b/.test(deps)) {
    failures.push(
      'The effect that creates the handoff depends on onCompleted. The parent passes an inline ' +
        'arrow, so every re-render tears the handoff down and creates another. Keep it in a ref.',
    );
  }
}

// ── Rule 5: a completed handoff is not cancelled on the way out ─────────────
// Checking that `completedRef` merely APPEARS is not enough — it is also set
// on success, so the rule would pass while the cleanup cancelled regardless.
// The cancel inside the cleanup must itself be guarded.
{
  const cleanupAt = qrCode.indexOf('return () => {');
  if (cleanupAt === -1) {
    failures.push('PunchHandoffQr has no effect cleanup; the handoff would be left live.');
  } else {
    const cleanup = qrCode.slice(cleanupAt, qrCode.indexOf('};', cleanupAt) + 2);
    if (!/cancelHandoff/.test(cleanup)) {
      failures.push('PunchHandoffQr no longer cancels its handoff when the dialog closes.');
    } else if (!/completedRef\.current/.test(cleanup)) {
      failures.push(
        'The effect cleanup cancels the handoff unconditionally. Unmount follows success ' +
          'immediately, so this races — and can cancel — the punch that just landed.',
      );
    }
  }
}

// ── Rule 6: the phone path does not depend on this device's location ────────
// The whole point of the either/or model: choosing the phone must never wait
// for, or be gated by, laptop geolocation or camera state.
const qrBlock = modalCode.slice(modalCode.indexOf('<PunchHandoffQr'));
const qrLine = qrBlock.slice(0, qrBlock.indexOf('/>') + 2);
for (const forbidden of ['geo.', 'geoBlocked', 'cam.', 'phase ===']) {
  if (qrLine.includes(forbidden)) {
    failures.push(
      `The <PunchHandoffQr> mount references ${forbidden}. The phone path must be usable ` +
        'immediately, whatever this device’s location or camera is doing.',
    );
  }
}
// It must not be rendered only when geolocation has already failed.
if (/geoBlocked\s*&&[\s\S]{0,400}<PunchHandoffQr/.test(modalCode)) {
  failures.push(
    'The phone route is rendered only once geolocation has failed. It is a first-class capture ' +
      'path, not an error fallback.',
  );
}

// ── Rule 7: failures are distinguishable ────────────────────────────────────
if (!/classifyHandoffFailure|describeHandoffFailure/.test(qrCode)) {
  failures.push(
    'PunchHandoffQr no longer classifies its failure. A 404, a 429 and a 500 rendering the same ' +
      'sentence is what hid the deployment mismatch during acceptance.',
  );
}
if (/'The phone link could not be created\.'/.test(qrCode)) {
  failures.push('The generic "phone link could not be created" fallback is back in the component.');
}
for (const code of ['ROUTE_MISSING', 'THROTTLED', 'SESSION_EXPIRED', 'SERVER_ERROR', 'NETWORK']) {
  if (!failure.includes(code)) failures.push(`handoff-failure.ts no longer classifies ${code}.`);
}

// ── Rule 8: evidence stays on one device ────────────────────────────────────
// A punch must never mix this device's location with the phone's photo, or the
// reverse: HR would hold one punch whose evidence came from two devices.
if (/geo\.sample/.test(mobileCode)) {
  failures.push('The mobile punch page reads a desktop location sample. Evidence must not mix.');
}
if (!/loc\.sample\.latitude/.test(mobileCode)) {
  failures.push('The mobile punch page does not submit the phone’s own coordinates.');
}
if (!/handoffToken/.test(mobileCode)) {
  failures.push(
    'The mobile punch page no longer sends the handoff token. Without it the server cannot claim ' +
      'the handoff, and replay protection never runs.',
  );
}
// The token module must stay importable by the backend test suite.
if (/^import\s/m.test(token)) {
  failures.push('handoff-token.ts imports something; it must stay dependency-free to be testable.');
}
if (/^import\s/m.test(failure)) {
  failures.push('handoff-failure.ts imports something; it must stay dependency-free.');
}
// The secret still belongs in the fragment only.
if (!/#token=/.test(api)) {
  failures.push('The QR URL no longer puts the token in the fragment.');
}
if (/mobile-punch\/\$\{[^}]*\}\/\$\{/.test(api) || /[?&]token=\$\{/.test(api)) {
  failures.push('The handoff token appears in a URL path or query string; it belongs in the fragment.');
}

if (failures.length > 0) {
  console.error('[attendance] Punch capture paths are not intact:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  `[attendance] Capture paths OK — one QR mount, phone path independent of this device, ` +
    `failures distinguishable, evidence unmixed (react ${reactVersion ?? 'unknown'}).`,
);
process.exit(0);
