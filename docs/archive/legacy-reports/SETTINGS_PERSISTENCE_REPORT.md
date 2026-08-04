# Settings Persistence Report — P1-A Product Stability

**Date:** 2026-05-27  
**Status:** Completed & Verified  

---

## Overview

The Settings page (`frontend/app/(dashboard)/settings/page.tsx`) has been enhanced to persist all administrative and company-wide configurations directly into the PostgreSQL database. All operations have been wired to backend API endpoints and validated.

---

## 1. Company Information Persistence

- **Fields Exposed & Saved**: Company Name, Tagline, Contact Email.
- **Enhanced Configurations**: Exposes and saves **Company Timezone** (e.g. `Asia/Kolkata`) and **Company Branding** (e.g., `Royal Blue`) defaults.
- **Backend Sync**: Integrates with the `Patch /settings/company` endpoint. Updates the JSON settings blob in the `appSetting` table under the `company` key.

---

## 2. Appearance & Company Theme Defaults

- **Theme Defaults**: Saves the default theme option (`technoedge-light`, `john-wick-dark`) to the backend.
- **Accent Defaults**: Saves default company accent color (e.g., `royal-blue`, `emerald`, `violet`).
- **Prisma Persistence**: Managed under the `theme_defaults` key in `appSetting` via the `SettingsService.upsertThemeDefaults` helper. New users automatically inherit these settings.

---

## 3. SMTP Configuration

- **Fields Exposed & Saved**: SMTP Host, Port, From Email, Password.
- **Security Features**:
  - Requires `SUPER_ADMIN` role level.
  - Masks the password/secret in API responses (`••••••••`).
  - Preserves the existing password if the user submits the form with the mask placeholder.
- **Backend Sync**: Integrates with the `GET /settings/smtp` and `PATCH /settings/smtp` endpoints, writing to the `smtp` key in the `appSetting` database table.

---

## 4. Leave Policy & SLA Targets

- **Leave Policy**: Exposes role-based leave quotas (Employee, Team Lead, Manager, Intern) and the global working day schedule (`Mon–Fri`, `Mon–Sat`, `Mon–Sun`). Persisted to `leave_policy` settings.
- **SLA targets**: Saves Response SLA hours (Urgent, High, Medium, Low) and Reviewer SLA hours. Persisted to `sla` and `review_sla` keys in `appSetting`.

---

## Verification Summary

1. **Database Persistence**: Tested edits across company, leave policy, and SMTP settings. Validated that reloading the page restores the updated settings from the database.
2. **Access Control**: Validated that workspace tabs (Company, Policies, Task Types) are only visible and editable by `ADMIN` or `SUPER_ADMIN` roles, and the `SMTP/Email` tab is only accessible to `SUPER_ADMIN`.
