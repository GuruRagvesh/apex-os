# Break warning sounds

Fixed application sounds for the break alarm. Each user's choice is stored as a
sound ID in their notification preferences (`breakWarningSound`), never as audio
in the database. The ID-to-file mapping lives in
`frontend/components/notifications/BreakSoundPicker.tsx`.

| ID | File | Supplied by | Usage rights |
|---|---|---|---|
| `apex-break` (default) | `apex-break.mp3` | Apex OS team | Confirmed for use in Apex OS (2026-11-05) |
| `chicken-call` | `chicken-call.mp3` | Apex OS team | Confirmed for use in Apex OS (2026-11-05) |
| `fahhh` | `fahhh.mp3` | Apex OS team | Confirmed for use in Apex OS (2026-11-05) |

Before adding a sound, record where it came from and who confirmed the right to
use and redistribute it inside Apex OS.
