/**
 * The exact list of browser origins allowed to call this API with credentials.
 *
 * Extracted from bootstrap() so it can be tested without starting the app, and
 * because "which origins may send our auth cookies" is a security rule that
 * deserves to be readable in one place.
 *
 * Two rules that must not be relaxed:
 *
 *  1. Never '*'. Every request carries credentials, and the browser refuses a
 *     wildcard with credentials anyway — reaching for one would break the
 *     thing it appeared to fix while removing the check entirely.
 *  2. Allow only exact origins. No regex over *.vercel.app: preview URLs are
 *     public and anyone can deploy to that domain, so a pattern would hand a
 *     credentialed cross-origin channel to any stranger's project.
 *
 * A request that arrives with no Origin header at all — Render's health probe,
 * curl, server-to-server — is unaffected: the browser only sends Origin for
 * cross-origin calls, and the cors middleware simply omits the response header.
 */

/** Origins that are always allowed, independent of environment. */
const STATIC_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://apex-os.vercel.app',
  'https://apex-os-frontend.vercel.app',
  'https://apex-os-frontend-git-main-guru-ragvesh-thanumoorthys-projects.vercel.app',
  // Dedicated staging frontend. Listed statically rather than left to an
  // environment variable so staging cannot be broken again by a missing var on
  // one service.
  'https://apex-os-frontend-staging.vercel.app',
];

/**
 * Normalises one configured origin.
 *
 * A browser sends `https://host` with no trailing slash, so a configured
 * `https://host/` would never match and would fail as a silent Network Error
 * with nothing in the logs to explain it.
 */
function normalise(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Resolves the allowlist.
 *
 * FRONTEND_URL is the pre-existing mechanism and keeps working unchanged.
 * CORS_ORIGINS extends it for deployments that need more than one origin;
 * both accept a comma-separated list, so neither needs a code change to add
 * an origin later.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = [env.FRONTEND_URL, env.CORS_ORIGINS]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .flatMap((v) => v.split(','))
    .map(normalise)
    .filter((v) => v.length > 0)
    // A wildcard is refused even when configured deliberately. With
    // credentials the browser rejects it anyway, so accepting one here could
    // only ever turn a visible misconfiguration into an invisible one.
    .filter((v) => !v.includes('*'));

  // Set keeps the list stable when an env var repeats something static.
  return Array.from(new Set([...STATIC_ORIGINS, ...configured]));
}
