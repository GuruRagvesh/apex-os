/**
 * Company timezone for cron scheduling (SS-1).
 *
 * TVAService is the company-time authority for everything that runs INSIDE a
 * request or job. Cron decorators cannot use it: they are evaluated when the
 * class is imported, long before Nest can inject anything. So the same value is
 * read here, from the same environment variable, with the same default.
 *
 * Why this matters: without an explicit timeZone, @Cron fires on SERVER-local
 * time. On Render that is UTC, so `@Cron('1 0 * * *')` — written to mean one
 * minute past midnight in the office — actually fires at 05:31 IST. Every
 * "daily" job intended for company-local time was running at the wrong hour,
 * and on a date boundary that can be the wrong DAY.
 *
 * Read from process.env directly rather than ConfigService because that is what
 * exists at import time; on Render, environment variables are real process env,
 * so this is the same value ConfigService would return.
 */
export const COMPANY_CRON_TIMEZONE = process.env.COMPANY_TIMEZONE || 'Asia/Kolkata';
