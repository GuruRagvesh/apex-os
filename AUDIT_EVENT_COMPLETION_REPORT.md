# Audit / Event Log Completion Report

**Date:** 2026-05-27  
**Sprint:** P1-B  
**Status:** COMPLETE

---

## Summary

All missing operational events have been wired. The `OperationalAction` enum was expanded from 29 entries to 50, and event logging calls were added to 7 service files.

---

## Enum Additions (event-logger.service.ts)

| Category | New actions added |
|----------|------------------|
| Tickets | `TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_REOPENED`, `COMMENT_ADDED`, `ATTACHMENT_UPLOADED` |
| Projects | `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_MEMBER_ADDED`, `PROJECT_MEMBER_REMOVED`, `PROJECT_DELETED` |
| Leave | `LEAVE_CANCELLED` (was missing — cancel was misusing `LEAVE_REJECTED`) |
| Users/Auth | `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `USER_ROLE_CHANGED` |
| Settings | `SETTINGS_UPDATED` |
| Exports | `EXPORT_PERFORMED` |

---

## Wiring by Service

### tickets.service.ts
| Trigger | Action |
|---------|--------|
| `updateStatus()` → status = CLOSED | `TICKET_CLOSED` |
| `updateStatus()` → DONE/CLOSED → OPEN/IN_PROGRESS | `TICKET_REOPENED` |
| `update()` non-status, non-assign | `TICKET_UPDATED` with fields metadata |

### tickets.controller.ts
| Trigger | Action |
|---------|--------|
| `POST /tickets/:id/attachments` | `ATTACHMENT_UPLOADED` |
| `GET /tickets/export` | `EXPORT_PERFORMED` |

### comments.service.ts
| Trigger | Action |
|---------|--------|
| `create()` after insert | `COMMENT_ADDED` |

### projects.service.ts
| Trigger | Action |
|---------|--------|
| `create()` | `PROJECT_CREATED` |
| `update()` | `PROJECT_UPDATED` |
| `addMember()` | `PROJECT_MEMBER_ADDED` |
| `removeMember()` | `PROJECT_MEMBER_REMOVED` |
| `remove()` | `PROJECT_DELETED` |

### users.service.ts
| Trigger | Action |
|---------|--------|
| `create()` | `USER_CREATED` |
| `update()` with `roleId` | `USER_ROLE_CHANGED` |
| `update()` without `roleId` | `USER_UPDATED` |
| `remove()` (deactivate) | `USER_DEACTIVATED` |

### settings.service.ts
| Trigger | Action |
|---------|--------|
| `set()` with `updatedBy` | `SETTINGS_UPDATED` |

### leave.service.ts
| Trigger | Action |
|---------|--------|
| `cancel()` | `LEAVE_CANCELLED` (was `LEAVE_REJECTED` — fixed) |

---

## Pre-existing (No Change Needed)

| Service | Already wired |
|---------|--------------|
| auth.service.ts | `USER_LOGIN`, `USER_LOGOUT`, `USER_AUTO_LOGOUT` |
| tickets.service.ts | `TICKET_CREATED`, `TICKET_ASSIGNED`, `TICKET_STARTED`, `TICKET_SUBMITTED_FOR_REVIEW`, `TICKET_DONE` |
| leave.service.ts | `LEAVE_REQUESTED`, `LEAVE_APPROVED`, `LEAVE_REJECTED` |
| workday.service.ts | `WORKDAY_STARTED`, `BREAK_STARTED`, `BREAK_ENDED`, `IDLE_DETECTED`, `IDLE_CLASSIFIED`, `WORKDAY_ENDED` |

---

## Global Injection Pattern

`EventLoggerService` is exported by `@Global() CommonModule` — all services receive it via NestJS DI without per-module imports. No `imports[]` changes were needed in any feature module.

---

## Verification

- `npx tsc --noEmit`: ✅ 0 errors
- `npx jest test/unit --forceExit`: ✅ 56/56 tests passed  
- p0.project-access.spec.ts: Updated to pass `mockEventLogger` to `ProjectsService` constructor.
