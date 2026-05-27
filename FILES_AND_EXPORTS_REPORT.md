# FILES AND EXPORTS REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ COMPLETE

---

## 1. File Upload Pipeline

### Architecture
```
Client → tickets.controller.ts (MIME filter + size limit)
       → uploadsService.uploadTicketAttachment()
           → Cloudinary API (production)
           → local disk (development)
       → DB record in ticket_attachments
       → EventLog: ATTACHMENT_UPLOADED
```

### Security Controls (P1-B Applied)
| Control | Implementation | Status |
|---------|---------------|--------|
| File size limit | `limits: { fileSize: 5 * 1024 * 1024 }` (5 MB) | ✅ |
| MIME type allowlist | 13 allowed types | ✅ |
| Type checked at controller | Before Cloudinary upload | ✅ |
| Audit log on upload | ATTACHMENT_UPLOADED event | ✅ |

### Allowed MIME Types
```
image/jpeg, image/png, image/gif, image/webp, image/svg+xml
application/pdf
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.ms-excel
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
text/plain, text/csv
application/zip
```

### Rejected Types
`application/x-executable`, `application/javascript`, `text/html`, `application/x-sh`, and all other executables are rejected with a `400 Bad Request` error message: `File type "${file.mimetype}" is not allowed`.

---

## 2. CSV Export Pipeline

### Architecture
```
Client GET /tickets/export?dateFrom=...&dateTo=...&status=...
  → tickets.controller.ts
      → ticketsService.exportCsv(query, user)
          → Prisma: filtered ticket query
          → CSV serialization
          → Response with Content-Type: text/csv headers
  → EventLog: EXPORT_PERFORMED (with query metadata)
```

### Date Range Passing (P1-B Applied)
`analytics/page.tsx` now passes `dateFrom`/`dateTo` to the export endpoint:
```typescript
const exportUrl = `${API_URL}/tickets/export?dateFrom=${dateFrom}&dateTo=${dateTo}`;
```
Previously exported all tickets regardless of displayed date range.

### Export Audit
```typescript
this.eventLogger.log({
  actorId: user.id,
  entityType: 'Ticket',
  entityId: 'export',
  action: OperationalAction.EXPORT_PERFORMED,
  metadata: { format: 'csv', filters: query },
}).catch(() => {});
```

### Access Control
Export endpoint is authenticated (JwtAuthGuard) but does not restrict by role. Any authenticated user can export visible tickets. The `exportCsv` service method respects the same visibility rules as `findAll` — non-admins only see tickets in their scope.

---

## 3. Document Upload (Users)

User documents (ID scans, contracts) are uploaded via `POST /users/:id/documents`. The upload route:
- Requires JWT authentication
- Checks: `requester.id === targetId || isAdmin` before processing
- Stored via `UploadsService` to Cloudinary

No MIME filter on the user documents endpoint — this should be added in P2.

---

## 4. Cloudinary Configuration

Environment variables required:
```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

If Cloudinary env vars are not set, `UploadsService` falls back to local disk storage (suitable for development). Production deployments **must** set Cloudinary vars to avoid storing files on the server filesystem.

See `backend/.env.production.example` for full documentation.

---

## 5. Export Format

Current CSV export includes:
- Ticket ID, title, status, priority, type
- Assigned user, reporter
- Created/updated dates
- SLA compliance flag

No XLSX export. P2 feature: add `exceljs` for native Excel export.

---

## Summary
| Check | Result |
|-------|--------|
| MIME type allowlist on ticket attachments | ✅ |
| 5 MB file size limit | ✅ |
| Audit log on attachment upload | ✅ |
| CSV export with date range | ✅ (P1-B) |
| Export audit log | ✅ (P1-B) |
| Document upload access check | ✅ |
| Cloudinary documented in .env.example | ✅ |
| User document MIME filter | ⚠️ P2 |
| XLSX export | ⚠️ P2 (not in scope) |
