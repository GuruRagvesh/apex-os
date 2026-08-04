# P0 Architecture Freeze

Date: 2026-05-27  
Tag: p0-verified-2026-05-27  
Branch: stabilize/apex-os-core

P0 is verified and closed.

The following services are now protected architecture and must not be bypassed:

- AccessPolicyService
- TicketAccessService
- TicketTimingService
- LeaveAccessService

Rules:
1. No direct role checks scattered in controllers.
2. No ticket list/count/query logic outside TicketAccessService/TicketQuery patterns.
3. No frontend-owned SLA truth.
4. No dashboard/global metrics without user scope.
5. No sensitive payroll/document exposure outside AccessPolicyService rules.
6. Any change touching these services requires regression tests.
7. P1/P2/P3 work must build on this architecture, not replace it.

Next phase: P1 product completion.
