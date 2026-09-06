# Supabase deployment

Current release and remaining external setup: [2026-09-06 release](../RELEASE-2026-09-06.md).
Apply all migrations before deploying the functions, then publish the frontend.

The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vite substitutes them into the production build; the static localhost server instead reads `runtime-config.js`. Service-role, encryption, cron, and push secrets stay in Supabase Edge Function secrets.

1. Create a Supabase project, enable Email/Password sign-in, and disable `Confirm email` for direct account creation. The frontend does not use OTP or Magic Link and requires the access and refresh tokens returned by Supabase.
2. Install dependencies, authenticate the Supabase CLI, link the project, then apply the migration: `supabase db push`.
3. Set server-only secrets: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... CARD_ENCRYPTION_KEY=... REMINDER_CRON_SECRET=... APP_ORIGIN=https://your-origin`.
   `CARD_ENCRYPTION_KEY` must be a randomly generated base64 encoding of exactly 32 bytes. Rotate it by adding a new key version and re-encrypting cards in a maintenance job.
4. Deploy: `supabase functions deploy claim-share-link create-request respond-request shared-record recipient-action creator-action card-access record-command push-device push-dispatch reminders --use-api`.
5. Schedule one authenticated POST to `reminders` each morning in Asia/Tehran. `scheduled-jobs.sql.template` is a Supabase Cron/Vault template; replace the project reference and create the Vault secret before applying it. Send `x-cron-secret`; do not expose it to a browser.

No raw share token is stored in the database: links are 256-bit random values and only SHA-256 hashes are persisted. Public token requests use service-role Edge Functions, which validate expiration/revocation and rate-limit the token/IP hash bucket before reading any record. RLS remains enabled on every application table.

In-app reminders are scheduled by the migration directly in PostgreSQL at 09:00 Tehran.
Web Push is implemented in `push-dispatch`, with device subscriptions and leased retry jobs.
It stays unconfigured until the server has VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
VAPID_SUBJECT plus an authorized cron caller. Never expose these private settings in
browser assets. `push_sent` means a provider accepted at least one device delivery;
it is not proof the user saw the notification. Disabled devices and terminal 404/410
subscriptions are not retried. Other failures back off up to eight attempts.
