#!/usr/bin/env node

/**
 * Verifies the deployed staging API, not the local source tree. This catches a
 * partial release where Vercel ships hierarchy UI before Render serves its API
 * and before the required Prisma migrations are present.
 *
 * Usage:
 *   STAGING_API_URL=https://apex-os-backend-staging.onrender.com/api \
 *   EXPECTED_COMMIT=<staging commit> \
 *   node scripts/deployment/verify-staging-hierarchy.mjs
 */

const rawApiBase =
  process.env.STAGING_API_URL ||
  'https://apex-os-backend-staging.onrender.com/api';
const apiBase = rawApiBase.replace(/\/+$/, '');
const expectedCommit = (process.env.EXPECTED_COMMIT || '').trim();
const deployTimeoutMs = Number.parseInt(
  process.env.STAGING_DEPLOY_TIMEOUT_MS || '0',
  10,
);
const deployPollIntervalMs = Number.parseInt(
  process.env.STAGING_DEPLOY_POLL_INTERVAL_MS || '15000',
  10,
);

if (!Number.isFinite(deployTimeoutMs) || deployTimeoutMs < 0) {
  throw new Error('STAGING_DEPLOY_TIMEOUT_MS must be a non-negative integer');
}

if (!Number.isFinite(deployPollIntervalMs) || deployPollIntervalMs <= 0) {
  throw new Error(
    'STAGING_DEPLOY_POLL_INTERVAL_MS must be a positive integer',
  );
}

async function request(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Status is still useful when a proxy returns a non-JSON error page.
  }
  return { response, body };
}

function fail(message) {
  console.error(`STAGING HIERARCHY VERIFICATION FAILED: ${message}`);
  process.exitCode = 1;
}

function commitsMatch(deployedCommit, expected) {
  return (
    deployedCommit.startsWith(expected) || expected.startsWith(deployedCommit)
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExpectedDeployment() {
  const deadline = Date.now() + deployTimeoutMs;
  let lastReason = 'the staging deployment is not ready';

  while (true) {
    try {
      const health = await request('/health');

      if (!health.response.ok || health.body?.status !== 'ok') {
        lastReason = `health returned HTTP ${health.response.status}`;
      } else if (health.body?.environment !== 'staging') {
        throw new Error(
          `health reported environment "${health.body?.environment ?? 'unknown'}", expected "staging"`,
        );
      } else if (!health.body?.release?.commit) {
        lastReason =
          'health does not expose a deployed commit; deploy the current backend build first';
      } else if (
        expectedCommit &&
        !commitsMatch(health.body.release.commit, expectedCommit)
      ) {
        lastReason = `backend commit ${health.body.release.commit} does not match expected staging commit ${expectedCommit}`;
      } else {
        return health;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('expected "staging"')
      ) {
        throw error;
      }
      lastReason = error instanceof Error ? error.message : 'unknown error';
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `${lastReason} after waiting ${Math.round(deployTimeoutMs / 1000)} seconds for the staging deployment`,
      );
    }

    const waitMs = Math.min(deployPollIntervalMs, remainingMs);
    console.log(
      `WAITING FOR STAGING DEPLOYMENT: ${lastReason}; retrying in ${Math.round(waitMs / 1000)} seconds`,
    );
    await sleep(waitMs);
  }
}

try {
  const health = await waitForExpectedDeployment();

  const readiness = await request('/health/release-readiness');
  if (!readiness.response.ok) {
    fail(
      `release-readiness returned HTTP ${readiness.response.status}; deploy the current backend build first`,
    );
  } else if (readiness.body?.organizationHierarchy?.ready !== true) {
    const applied =
      readiness.body?.organizationHierarchy?.appliedMigrations ?? 0;
    const required =
      readiness.body?.organizationHierarchy?.requiredMigrations ?? 'unknown';
    fail(
      `organization hierarchy migrations are not ready (${applied}/${required} applied)`,
    );
  }

  // The endpoint is protected. An unauthenticated 401 proves the deployed
  // backend registered the route; a 404 is the frontend/backend drift that
  // this verifier exists to prevent.
  const hierarchy = await request('/organization-hierarchy/organization');
  if (![401, 403].includes(hierarchy.response.status)) {
    fail(
      `organization hierarchy endpoint returned HTTP ${hierarchy.response.status}; expected 401 or 403`,
    );
  }

  if (!process.exitCode) {
    console.log(
      `STAGING HIERARCHY VERIFIED: ${apiBase} @ ${health.body.release.commit}`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'unknown verification error');
}
