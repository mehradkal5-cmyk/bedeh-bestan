alter table public.repayments
  add column if not exists receipt_path text,
  add column if not exists receipt_name text check (receipt_name is null or char_length(receipt_name) between 1 and 180),
  add column if not exists receipt_mime text check (receipt_mime is null or receipt_mime in ('image/jpeg','image/png','image/webp','application/pdf'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload own receipts" on storage.objects;
create policy "upload own receipts" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "read own receipts" on storage.objects;
create policy "read own receipts" on storage.objects
for select to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "delete own receipts" on storage.objects;
create policy "delete own receipts" on storage.objects
for delete to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
