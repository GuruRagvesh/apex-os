# FP-20D: Dashboard Clock Widget Documentation

## Overview
A `TVAClockWidget` has been implemented and mounted to the main dashboard. It queries the backend API (`/api/tva/clock` which is proxied to the NestJS backend) to retrieve the official company time, date, and timezone.

## Requirements Satisfied
- [x] Fetches `GET /api/tva/clock` upon mount.
- [x] Displays company date (from TVA).
- [x] Displays company time.
- [x] Displays timezone.
- [x] Displays source as `SERVER_TVA`.
- [x] Displays Sync Status (`SYNCING`, `SYNCED`, `ERROR`).
- [x] Visually ticks locally using an interval.
- [x] Resyncs from the server every 45 seconds.
- [x] Displays a drift warning if the visual elapsed time differs from the local browser clock by > 5 seconds, warning the user that their system time is incorrect.
- [x] Included warning disclaimer: "Never use this widget for official business calculations."

## Location
- Component: `frontend/components/TVAClockWidget.tsx`
- Helper: `frontend/lib/tva-clock.ts`
- Mounted in: `frontend/app/(dashboard)/(core)/dashboard/page.tsx`
