# FP18A RUNTIME ISSUE REGISTER

| ID | Module | Role/account tested | Steps to reproduce | Expected behavior | Actual behavior | Severity | Status | Recommended fix pack | Evidence/screenshot/log |
|---|---|---|---|---|---|---|---|---|---|
| ISSUE-01 | Auth | Any | Run automated test script hitting `POST /auth/login` > 5 times in 15 mins. | Successful login | 429 Too Many Requests | P1 | Open | N/A (App behavior is correct) | `Login failed with 429` |
| ISSUE-02 | Auth | Any | Submit `POST /auth/forgot-password` with unverified fake email domain | OTP sent to email | Fake domain emails fail delivery on Resend due to strict SMTP/domain validation rules | P2 | Open | FP-11B (Email config) | `Forgot password failed: 400 / Resend error` |
| ISSUE-03 | Tickets | Employee | Submit `POST /tickets` with `"category": "GENERAL"` | Ticket created | Rejected with 400 Bad Request `Invalid value for argument category. Expected TicketCategory.` | P1 | Deferred (Test Script error) | N/A | Server logs: `Invalid value for argument category.` |
| ISSUE-04 | Hierarchy | Employee | Submit `POST /users/:id/change-requests` with flat field instead of `changes: [{}]` array | Request created | 500 Internal Server Error due to `Cannot read properties of undefined (reading 'map')` | P2 | Open | FP-15B.3 (Validate DTOs early) | Logs: `TypeError: Cannot read properties of undefined (reading 'map') at ChangeRequestsService.createChangeRequest` |
