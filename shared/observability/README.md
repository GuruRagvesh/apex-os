# shared/observability/

Instrumentation, error reporting, and structured logging setup.

**Status: Phase 0 — empty scaffold.** Live code includes
`backend/src/instrument.ts`.

## May live here

- Error-reporting SDK initialisation.
- Tracing and performance instrumentation setup.
- Structured logging configuration.
- Correlation/request-ID propagation helpers.

## Must not live here

- The **audit trail**. `OperationalEvent` and `AttendanceEvent` are business
  records — who approved what, when a session closed — not telemetry. They
  belong to `platforms/system/audit`.

  The distinction: observability tells engineers how the system is behaving;
  audit tells the company what happened to its data. They have different
  retention, different access rules, and different consumers.

- Health-check endpoints — those are `platforms/system/health`.
- Secrets or DSNs. Those come from environment variables.

## Dependency direction

```
apps/*      → shared/observability   (initialised at bootstrap)
platforms/* → shared/observability   (logging helpers only)
shared/observability → (nothing)
```

## Note on logging discipline

Never log credentials, tokens, connection strings, or personal data. Attendance
and leave records are personal data — log identifiers, not contents.
