# Apex OS Push Notifications — Release Setup

The implementation is complete in code, but background notifications remain disabled until each environment has its own VAPID key pair and the new database migration is applied during that environment's normal release.

## One-time environment setup

1. Generate a VAPID key pair on a trusted administrator machine. Never paste the private key into Git, Vercel, screenshots, chat, or a frontend variable.
2. In the **staging Render backend**, add:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (for example, a monitored `mailto:` address)
3. Use a different key pair for the **production Render backend** and add the same three variable names there.
4. Apply the pending Prisma migrations through the approved backup-and-release process. Do not apply them from Vercel.
5. Deploy the backend, then deploy the matching frontend build. The frontend fetches the public key from the authenticated backend; no VAPID secret belongs in Vercel.

## Per-device activation

1. Sign in to Apex OS on the computer or phone.
2. Open **Settings → Notifications**.
3. Keep **System push notifications** enabled.
4. Select **Enable notifications on this device** and allow the browser permission.
5. Repeat on every device that should receive alerts.

On iPhone/iPad, install Apex OS to the Home Screen first and open the installed app before enabling notifications. Android and desktop browsers can register directly when Web Push is supported.

## Safe verification

1. Start a planned break with an end time a few minutes ahead.
2. Put Apex OS in the background; do not keep its tab focused.
3. Confirm one break-overrun notification appears after the planned end time.
4. Confirm the same notification exists in the Apex OS notification list.
5. Sign out and confirm that device no longer receives private Apex OS push alerts.

Push cannot arrive while a device is powered off or has no network. The push provider may deliver it after connectivity returns while its one-hour delivery window is still valid.
