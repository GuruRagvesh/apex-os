# Google Drive employee archive — setup

Archive & Delete will not delete anybody until it has put a verified archive
in Google Drive. Until these three variables are set, every attempt fails at
the archive stage and **the employee remains** — which is the intended
behaviour, not a bug to work around.

There is deliberately no fallback to R2, S3, Cloudinary or local disk. An
archive written somewhere nobody will look for it is worse than a refused
deletion.

---

## 1. The service account

1. In Google Cloud Console, pick (or create) the project that owns Apex OS
   integrations.
2. Enable the **Google Drive API** for it.
3. Create a **service account**. It needs no project IAM roles — its access
   comes from the Drive folder being shared with it, not from Cloud IAM.
4. Create a **JSON key** for the service account and download it. This is the
   only time Google will show you the private key.

Keep the JSON out of the repository. Nothing in Apex OS reads a JSON file;
the two values it needs are copied out of it into environment variables.

## 2. The folder

1. In Google Drive, create a folder for employee archives — a dedicated one,
   not a shared team folder.
2. Share it with the service account's email address (`client_email` in the
   JSON), with **Editor** access.
3. Take the folder id from its URL:
   `https://drive.google.com/drive/folders/`**`<THIS PART>`**

Who can read that folder is the real access control on every archive. The
archives contain employment records, including payroll and statutory
identifiers, so treat the folder's sharing list as you would a payroll
system's.

## 3. The variables

| Variable | Where it comes from |
|---|---|
| `GOOGLE_DRIVE_CLIENT_EMAIL` | `client_email` in the service-account JSON |
| `GOOGLE_DRIVE_PRIVATE_KEY` | `private_key` in the same JSON |
| `GOOGLE_DRIVE_ARCHIVE_FOLDER_ID` | the folder id from step 2 |

Set them on the backend service (Render → Environment). They are secrets:
never commit them, never paste them into a ticket, never log them.

### The newline problem

`private_key` is a PEM containing real newlines. Most dashboards store it as
a single line with literal `\n` sequences instead, and the resulting failure
is an opaque "invalid key" from the JWT signer with nothing pointing at the
cause.

The adapter converts literal `\n` back to real newlines, so **either form
works**. Paste whichever your dashboard accepts without mangling.

---

## 4. Checking it

The adapter reports configuration problems by **variable name and never by
value** — a configuration error that quotes part of a private key back at you
is how secrets end up in logs and screenshots.

With anything missing, an Archive & Delete attempt fails with:

```
Google Drive archiving is not configured. Missing: GOOGLE_DRIVE_PRIVATE_KEY.
```

and the employee is untouched.

## 5. Scope

The service account requests `https://www.googleapis.com/auth/drive.file`
only. That scope limits it to files it created itself, so a bug in Apex OS
cannot read, move or delete anything else in the Drive — including the rest
of the folder it was given.

Do not widen it to `auth/drive`. Nothing here needs it.

---

## 6. What lands in the folder

```
APEX_EMPLOYEE_ARCHIVE_TE-014_20261003-060000.zip
```

Employee id and a timestamp, never the person's name alone: two people called
Priya Sharma must not shadow each other.

Inside, a `manifest.json` describing what was collected and what was
deliberately excluded, the employee's profile, and one JSON file per dataset —
attendance, leave, comp off, tickets, comments, audit history, and a
`relationships/summary.json` recording what happened to every relation that
pointed at them.

No password hash and no authentication secret of any kind is in it. The
manifest names every excluded category explicitly, so a reader can tell "there
are none in here" from "this system never had any".

---

## 7. Verifying a restore, before you need one

Archives are only useful if somebody has opened one. Once configured, run a
deletion against a **synthetic staging employee** and then:

1. Download the ZIP from the folder.
2. Open `manifest.json` and check `entityCounts` against what that employee
   had.
3. Confirm `excludedSecretCategories` is present and no `password` key appears
   anywhere in the archive.

Never rehearse this against a real employee, and never against production.
