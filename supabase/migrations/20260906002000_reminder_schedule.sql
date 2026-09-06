-- In-app reminders need no external push credentials. The existing function
-- atomically respects each party's preferences and deduplicates Tehran days.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('bedeh-bestan-in-app-reminders','30 5 * * *',
  'select public.create_due_reminders();');

drop policy if exists "upload own receipts" on storage.objects;
create policy "upload accessible receipts" on storage.objects for insert to authenticated with check (
  bucket_id='receipts' and (storage.foldername(name))[1]=(select auth.uid()::text)
  and case when (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_access_record(((storage.foldername(name))[2])::uuid) else false end
);
