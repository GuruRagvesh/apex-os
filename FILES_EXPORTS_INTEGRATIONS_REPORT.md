# Files, Exports & Integrations Report

**Date:** 2026-05-27  
**Sprint:** P1-B  
**Status:** COMPLETE

---

## 1. MIME Type Validation (Attachment Upload)

**Gap:** `POST /tickets/:id/attachments` had a fileSize limit but no MIME type restriction, allowing any file type to be uploaded.

**Fix:** `backend/src/modules/operations/tickets/tickets.controller.ts` — multer `fileFilter` added to `FileInterceptor`:

```typescript
fileFilter: (_req, file, cb) => {
  const ALLOWED_MIME = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/zip',
  ];
  if (ALLOWED_MIME.includes(file.mimetype)) { cb(null, true); }
  else { cb(new Error(`File type "${file.mimetype}" is not allowed`), false); }
}
```

**Limits in effect:**
- Max file size: 5 MB
- Allowed types: images (JPEG/PNG/GIF/WebP/SVG), PDF, Word, Excel, plain text, CSV, ZIP

---

## 2. SMTP Graceful Failure Path (Pre-existing, Verified)

All `emailService.send*()` calls throughout the codebase are wrapped in `try { … } catch (_e) { /* never crash main op */ }`. This pattern is consistent across:
- `tickets.service.ts` — SLA breach notifications
- `leave.service.ts` — `approve()` and `reject()`

Email failures are silently swallowed — the primary operation always succeeds even if SMTP is misconfigured. No new changes needed.

---

## 3. Export Scoping (Pre-existing, Verified)

`TicketsService.exportCsv()` delegates to `TicketAccessService.buildTicketWhereForUser()` before querying. This ensures:
- Employees only export their own tickets
- Managers export their department's tickets  
- Admins export all tickets

The same scope is applied to both the JSON list endpoint and the CSV export endpoint.

---

## 4. Cloudinary / Base64 Upload Path (Pre-existing, Verified)

`UploadsService.uploadTicketAttachment()` handles two upload paths:
1. If `CLOUDINARY_URL` is configured → uploads to Cloudinary and returns URL.
2. Fallback → stores as base64 data URI.

Both paths work correctly. No changes needed.

---

## Verification

- `npx tsc --noEmit`: ✅ 0 errors
- `npx jest test/unit --forceExit`: ✅ 56/56 tests passed
