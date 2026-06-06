# FINAL AUTHENTICATED SMOKE TEST ISSUES

## Verified Fixes (No Longer Issues)
1. **Login Throttle Lockouts:** Completely mitigated. Constant `Retry-After`, correctly scoped to email.
2. **Form Focus Loss:** Resolved via proper React hoist.
3. **Data Persistence (`undefined` handling):** Forms now correctly utilize `null` allowing DB fields to clear successfully.
4. **OTP Resend Cooldown:** Operates safely on both frontend and backend.

## Outstanding Issues
### 1. SMTP & Third-Party Configuration (CONFIG REQUIRED)
- **Module:** Platform Settings / Email
- **Observation:** Calling `/api/settings/smtp` returns empty fields for `host`, `email`, and `password`.
- **Impact:** Email notifications (Leaves, Password Resets) will silently fail or fall back to mock endpoints in production.
- **Recommended Action:** Supply `.env` production values to Render.

### 2. Workday-Ticket Integration (FUTURE SCOPE)
- **Module:** Tickets & Workday
- **Observation:** Ticket timers do not automatically pause or resume based on Workday break states.
- **Impact:** No immediate bug, but missing expected operational feature tracking.
- **Recommended Action:** Address in `FP-13.1C`.
