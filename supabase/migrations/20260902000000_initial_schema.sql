create extension if not exists pgcrypto;

create type public.record_kind as enum ('item', 'money', 'expense');
create type public.record_status as enum ('draft', 'active', 'completed', 'overdue', 'cancelled');
create type public.participant_role as enum ('recipient', 'contributor');
create type public.repayment_status as enum ('recorded', 'confirmed', 'rejected');
create type public.notification_kind as enum ('three_days', 'tomorrow', 'today', 'overdue');
create type public.delivery_state as enum ('in_app', 'push_sent', 'push_failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete restrict,
  kind public.record_kind not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount numeric(14, 0) check (amount is null or amount > 0),
  currency text not null default 'IRR' check (currency in ('IRR', 'IRT')),
  due_at timestamptz,
  status public.record_status not null default 'active',
  notes text check (notes is null or char_length(notes) <= 2000),
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((kind = 'money' and amount is not null) or kind <> 'money')
);

create table public.record_participants (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  role public.participant_role not null default 'recipient',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (record_id, user_id),
  unique (record_id, display_name)
);

create table public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null unique references public.records(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  encrypted_number text not null,
  encryption_iv text not null,
  key_version smallint not null default 1 check (key_version > 0),
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  network text,
  bank_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repayments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  amount numeric(14, 0) not null check (amount > 0),
  payer_name text not null check (char_length(trim(payer_name)) between 1 and 80),
  status public.repayment_status not null default 'recorded',
  recorded_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500)
);

create table public.record_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.records(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text,
  event_type text not null check (event_type in ('record_created','share_link_created','receipt_confirmed','extension_requested','repayment_recorded','repayment_confirmed','item_returned','link_revoked','reminder_sent','due_date_changed')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminders_enabled boolean not null default true,
  push_enabled boolean not null default false,
  push_subscription jsonb,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid references public.records(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(title) <= 140),
  body text not null check (char_length(body) <= 500),
  delivery public.delivery_state not null default 'in_app',
  delivery_attempted_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Stores a one-way bucket and never a raw share token or IP address.
create table public.public_action_rate_limits (
  bucket_hash text primary key check (char_length(bucket_hash) = 64),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);

create index records_creator_due_idx on public.records (creator_id, due_at);
create index record_participants_user_idx on public.record_participants (user_id, record_id) where user_id is not null;
create index events_record_created_idx on public.record_events (record_id, created_at desc);
create index repayments_record_idx on public.repayments (record_id, recorded_at desc);
create index share_links_record_idx on public.share_links (record_id) where revoked_at is null;
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create unique index notifications_daily_dedupe_idx on public.notifications (user_id, record_id, kind, ((created_at at time zone 'Asia/Tehran')::date));

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger records_updated before update on public.records for each row execute function public.set_updated_at();
create trigger payment_cards_updated before update on public.payment_cards for each row execute function public.set_updated_at();
create trigger notification_preferences_updated before update on public.notification_preferences for each row execute function public.set_updated_at();

create or replace function public.can_access_record(target_record_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.records r where r.id = target_record_id and r.creator_id = auth.uid())
      or exists (select 1 from public.record_participants p where p.record_id = target_record_id and p.user_id = auth.uid());
$$;

create or replace function public.is_record_creator(target_record_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.records r where r.id = target_record_id and r.creator_id = auth.uid());
$$;

-- Called only by the service-role Edge Functions. It atomically enforces a per-link/IP bucket.
create or replace function public.claim_public_rate_limit(target_bucket_hash text, max_requests integer default 30)
returns boolean language plpgsql security definer set search_path = public as $$
declare permitted boolean;
begin
  insert into public.public_action_rate_limits as l (bucket_hash, window_started_at, request_count, updated_at)
  values (target_bucket_hash, now(), 1, now())
  on conflict (bucket_hash) do update set
    window_started_at = case when l.window_started_at < now() - interval '1 minute' then now() else l.window_started_at end,
    request_count = case when l.window_started_at < now() - interval '1 minute' then 1 else l.request_count + 1 end,
    updated_at = now();
  select request_count <= max_requests into permitted from public.public_action_rate_limits where bucket_hash = target_bucket_hash;
  return coalesce(permitted, false);
end;
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1))) on conflict do nothing;
  insert into public.notification_preferences(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.record_participants enable row level security;
alter table public.payment_cards enable row level security;
alter table public.repayments enable row level security;
alter table public.record_events enable row level security;
alter table public.share_links enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.public_action_rate_limits enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "read accessible records" on public.records for select using (public.can_access_record(id));
create policy "create own records" on public.records for insert with check (creator_id = auth.uid());
create policy "creator updates records" on public.records for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "creator deletes records" on public.records for delete using (creator_id = auth.uid());
create policy "read accessible participants" on public.record_participants for select using (public.can_access_record(record_id));
create policy "creator manages participants" on public.record_participants for all using (public.is_record_creator(record_id)) with check (public.is_record_creator(record_id));
create policy "owner sees encrypted card row" on public.payment_cards for select using (owner_id = auth.uid());
create policy "owner manages encrypted card row" on public.payment_cards for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_record_creator(record_id));
create policy "read accessible repayments" on public.repayments for select using (public.can_access_record(record_id));
create policy "creator manages repayments" on public.repayments for all using (public.is_record_creator(record_id)) with check (public.is_record_creator(record_id));
create policy "read accessible events" on public.record_events for select using (public.can_access_record(record_id));
create policy "creator reads share links" on public.share_links for select using (created_by = auth.uid());
create policy "creator manages share links" on public.share_links for all using (public.is_record_creator(record_id)) with check (public.is_record_creator(record_id));
create policy "own notification preferences" on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "mark own notification read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.public_action_rate_limits from anon, authenticated;
revoke all on function public.claim_public_rate_limit(text, integer) from anon, authenticated;
grant execute on function public.claim_public_rate_limit(text, integer) to service_role;
