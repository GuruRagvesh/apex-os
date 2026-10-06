/**
 * EMERGENCY DATA PROTECTION LAYER
 * Destructive Operation Guard
 * 
 * Protects against accidental wipe/reset scripts running in production.
 */

export function preventDestructiveOperation(operationName: string) {
  if (
    process.env.APP_ENV === 'production' &&
    process.env.ALLOW_DESTRUCTIVE_OPERATIONS !== 'YES_I_UNDERSTAND'
  ) {
    throw new Error(
      `[SAFETY GUARD] Destructive operation '${operationName}' BLOCKED.\\n` +
      `You are attempting to run a script containing 'deleteMany', 'truncate', 'reset', or similar against the PRODUCTION environment.\\n` +
      `To explicitly allow this, you must set ALLOW_DESTRUCTIVE_OPERATIONS=YES_I_UNDERSTAND.`
    );
  }
}
