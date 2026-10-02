/**
 * EMERGENCY DATA PROTECTION LAYER
 * Destructive Operation Guard
 *
 * Protects against accidental wipe/reset scripts running in production.
 */

/**
 * Which environment this process is actually running in.
 *
 * APP_ENV WHEN SUPPLIED, OTHERWISE NODE_ENV, and the fallback is the whole
 * point of this function. The guard previously tested `APP_ENV === 'production'`
 * alone, so a production service whose APP_ENV was never set -- which is easy,
 * because nothing failed without it and it was undocumented until recently --
 * had NO guard at all. The protection was silently absent exactly where it
 * mattered, and nothing reported that.
 *
 * NOT FAIL-CLOSED ON A MISSING VALUE, deliberately. Refusing whenever the
 * environment cannot be proven would be safer in the abstract and would break
 * ordinary local development, where neither variable is set and seeding is a
 * routine thing to do. Falling through to NODE_ENV closes the real hole --
 * a deployed service always sets NODE_ENV=production -- without turning every
 * developer's machine into a locked environment.
 *
 * AN EXPLICIT APP_ENV ALWAYS WINS, including when it disagrees with NODE_ENV.
 * Staging runs with NODE_ENV=production because it is a production build; it
 * is APP_ENV that says it is staging, and a staging box must not be treated
 * as production by a guard that ignores it.
 *
 * An empty or whitespace-only APP_ENV counts as not supplied: a dashboard
 * field someone cleared is an absent value, not a declaration that the
 * environment is named "".
 */
export function resolveEnvironment(
  env: { APP_ENV?: string; NODE_ENV?: string } = process.env as any,
): string {
  const explicit = (env.APP_ENV ?? '').trim();
  if (explicit) return explicit.toLowerCase();

  const fallback = (env.NODE_ENV ?? '').trim();
  return fallback ? fallback.toLowerCase() : 'development';
}

/** Is this process running against production data? */
export function isProductionEnvironment(
  env: { APP_ENV?: string; NODE_ENV?: string } = process.env as any,
): boolean {
  return resolveEnvironment(env) === 'production';
}

export function preventDestructiveOperation(operationName: string) {
  if (
    isProductionEnvironment() &&
    process.env.ALLOW_DESTRUCTIVE_OPERATIONS !== 'YES_I_UNDERSTAND'
  ) {
    throw new Error(
      `[SAFETY GUARD] Destructive operation '${operationName}' BLOCKED.\n` +
      `You are attempting to run a script containing 'deleteMany', 'truncate', 'reset', or similar against the PRODUCTION environment.\n` +
      `To explicitly allow this, you must set ALLOW_DESTRUCTIVE_OPERATIONS=YES_I_UNDERSTAND.`
    );
  }
}
