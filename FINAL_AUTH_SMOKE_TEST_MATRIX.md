# FINAL AUTHENTICATED SMOKE TEST MATRIX

| Module | Test Performed | Observed Result | Expected Result | Evidence | Classification | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|
| **Deployment** | Load Frontend & Backend Health | Both load, DB connected | 200 OK, Production env | `/api/health` returned OK | VERIFIED OK | P0 | None |
| **Auth** | Login as SUPER_ADMIN | Login succeeds, returns token | Dashboard opens, `/api/auth/me` OK | API response token captured | VERIFIED OK | P0 | None |
| **Auth** | Throttle wrong passwords | 429 triggered after limit | Lockout window limits user | `Retry-After: 50` returned | VERIFIED OK | P0 | None |
| **Auth** | Throttle window extension | `Retry-After` stays constant | Lockout does not extend | `Retry-After: 50` on retries | VERIFIED OK | P0 | None |
| **Auth** | Cross-user Throttle | Different email gets 401 | User B not locked out | 401 Unauthorized for User B | VERIFIED OK | P1 | None |
| **Projects** | View project list | 3 projects returned | List loads | `/api/projects` JSON | VERIFIED OK | P1 | None |
| **Projects** | Detail load and Edit | Safe edit persists | Edit saves correctly | `description` reverted safely | VERIFIED OK | P1 | None |
| **Tickets** | Reassign DONE ticket | HTTP 400 Bad Request | Request blocked | "Cannot reassign a DONE ticket" | VERIFIED OK | P1 | None |
| **Tickets** | Edit CLOSED ticket | HTTP 400 Bad Request | Request blocked | "Cannot modify a closed ticket" | VERIFIED OK | P1 | None |
| **Tickets** | Complete while ON_BREAK | HTTP 400 Bad Request | Request blocked | "Resume work before submitting" | VERIFIED OK | P1 | None |
| **Workday** | Get today status | Returns ON_BREAK | Workday state loads | `/api/workday/today` | VERIFIED OK | P1 | None |
| **Workday** | End break | Break ends, calc 44 min | Duration logged | `/api/workday/break/end` | VERIFIED OK | P1 | None |
| **Notifications**| Load list | Returns 4 items (isRead) | Notifications populate | `/api/notifications` | VERIFIED OK | P2 | None |
| **Leave** | Load balance | Returns 10 available | Balance populates | `/api/leave/balance` | VERIFIED OK | P1 | None |
| **Settings** | Check SMTP config | Empty config returned | Real config missing | `/api/settings/smtp` | CONFIG REQUIRED| CONFIG | Add keys to `.env` |
| **Settings** | Form Focus/Cursor | Static hoist deployed | Forms don't unmount | Codebase inspection | VERIFIED OK | P2 | None |
| **Settings** | Save/Persist relations| Null maps deployed | `departmentId` saves | Codebase inspection | VERIFIED OK | P1 | None |
