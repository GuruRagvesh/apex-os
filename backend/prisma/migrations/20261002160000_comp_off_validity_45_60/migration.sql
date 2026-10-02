-- The approved comp off validity: 45 days by default, 60 days at the most.
--
-- PURELY ADDITIVE AND NON-REWRITING. One new nullable column, and a change to
-- the DEFAULT of an existing one. A default applies only to rows inserted
-- after it, so every leave policy that already exists keeps the value it
-- already holds and no employee's current credits move.
--
-- WHY A MAXIMUM IN DAYS. The workflow could already express a default and an
-- absolute ceiling, but only in calendar months. The company rule is 45 and 60
-- DAYS, which months cannot express, so the days unit had a default and no
-- ceiling at all -- every extension was refused as NO_MAXIMUM_CONFIGURED. The
-- rule was not unconfigured, it was inexpressible.

-- New default for policies created from here on.
ALTER TABLE "leave_policies"
  ALTER COLUMN "compOffExpiryDays" SET DEFAULT 45;

-- The ceiling, measured from the grant date. NULL means no maximum has been
-- configured, which refuses extensions rather than permitting unlimited ones.
ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "compOffMaximumValidityDays" INTEGER;

-- DELIBERATELY NOT BACKFILLED.
--
-- Setting every existing policy to 45/60 here would rewrite an entitlement
-- rule for employees whose credits were granted under the old one, which is
-- the same class of mistake as applying today's attendance policy to a
-- finalized month. Existing policies keep 30 until somebody changes them
-- through the settings screen, deliberately, with a record of who did it.
