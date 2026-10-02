/**
 * The switch that decides whether anybody can actually be deleted.
 *
 * OFF BY DEFAULT, AND THE DEFAULT IS THE POINT. Archive & Delete is finished
 * code, tested and reviewed, but it destroys an account irreversibly and it
 * has never been run against real data. Shipping it live the moment it merges
 * would mean the first real use is also the first use -- so production
 * deploys with it off, staging turns it on to exercise it against a synthetic
 * employee, and it is enabled in production deliberately, later, by somebody
 * who has decided to.
 *
 * NOT A NEW FEATURE-FLAG FRAMEWORK. It follows the shape attendance already
 * uses: one AppSetting row holding a small object of booleans, every one of
 * them defaulting false, read at the point of use. A separate key from
 * `attendance_v2` because this is user lifecycle and not attendance, and a
 * flag filed under the wrong feature is one somebody toggles by accident.
 *
 * WHY A FLAG WHEN MISSING DRIVE CREDENTIALS ALREADY BLOCK IT. They do: with
 * no credentials the upload throws, the archive fails, and nothing is
 * deleted. But that is incidental safety, and it evaporates the moment Drive
 * is configured -- which is exactly what the staging work requires. The flag
 * says "not yet" independently of whether the plumbing happens to work.
 */

export const EMPLOYEE_LIFECYCLE_SETTING_KEY = 'employee_lifecycle';

export const EMPLOYEE_LIFECYCLE_DEFAULTS = {
  /**
   * Permits the destructive Archive & Delete action.
   *
   * False means the endpoint refuses for everybody, including Super Admin.
   * It is not a UI preference.
   */
  archiveDeleteEnabled: false,
} as const;

/**
 * Reads the flag out of whatever the Json setting column holds.
 *
 * ANYTHING OTHER THAN EXACTLY `true` IS OFF. Not truthy -- `true`. A setting
 * holding the string "false", or 0, or an unrelated object, must not enable
 * an irreversible operation because it happened to be non-empty. The failure
 * direction is chosen deliberately: a flag misread as off costs somebody a
 * support request, and a flag misread as on costs an employee.
 */
export function isArchiveDeleteEnabled(settingValue: unknown): boolean {
  if (!settingValue || typeof settingValue !== 'object') {
    return EMPLOYEE_LIFECYCLE_DEFAULTS.archiveDeleteEnabled;
  }
  return (settingValue as any).archiveDeleteEnabled === true;
}
