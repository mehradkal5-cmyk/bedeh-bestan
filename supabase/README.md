# Supabase deployment

The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vite substitutes them into the production build; the static localhost server instead reads `runtime-config.js`. Service-role, encryption, cron, and push secrets stay in Supabase Edge Function secrets.

1. Create a Supabase project, enable Email/Password sign-in, and disable `Confirm email` for direct account creation. The frontend does not use OTP or Magic Link and requires the access and refresh tokens returned by Supabase.
2. Install dependencies, authenticate the Supabase CLI, link the project, then apply the migration: `supabase db push`.
3. Set server-only secrets: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... CARD_ENCRYPTION_KEY=... REMINDER_CRON_SECRET=... APP_ORIGIN=https://your-origin`.
   `CARD_ENCRYPTION_KEY` must be a randomly generated base64 encoding of exactly 32 bytes. Rotate it by adding a new key version and re-encrypting cards in a maintenance job.
4. Deploy: `supabase functions deploy shared-record recipient-action card-access record-command reminders`.
5. Schedule one authenticated POST to `reminders` each morning in Asia/Tehran. `scheduled-jobs.sql.template` is a Supabase Cron/Vault template; replace the project reference and create the Vault secret before applying it. Send `x-cron-secret`; do not expose it to a browser.

No raw share token is stored in the database: links are 256-bit random values and only SHA-256 hashes are persisted. Public token requests use service-role Edge Functions, which validate expiration/revocation and rate-limit the token/IP hash bucket before reading any record. RLS remains enabled on every application table.

The reminder function currently records successful in-app delivery only. Add Web Push delivery in a server-only worker after a creator explicitly enables it and subscribes; retain `push_failed` for a failed provider attempt. Do not mark push as sent without a provider success response.
