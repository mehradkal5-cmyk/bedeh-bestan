-- Additive schema; old records and events remain intact. All workflow writers
-- serialize on the record row; service-only RPCs receive the verified user ID.
alter table public.records add column shares_configured boolean not null default false;
alter table public.record_participants add column membership_status text not null default 'unclaimed'
  check (membership_status in ('unclaimed','accepted')),
  add column share_amount numeric(14,0) check (share_amount > 0);
update public.record_participants set membership_status = 'accepted' where user_id is not null;

create table public.record_requests (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  requester_id uuid references auth.users(id) on delete set null,
  participant_id uuid references public.record_participants(id) on delete restrict,
  kind text not null check (kind in ('membership','extension','return','payment')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payload jsonb not null default '{}',
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  unique(requester_id, idempotency_key)
);
create index requests_record_idx on public.record_requests(record_id, created_at desc);
create unique index requests_pending_membership_idx on public.record_requests(record_id, requester_id)
  where kind = 'membership' and status = 'pending';
alter table public.repayments add column request_id uuid unique references public.record_requests(id),
  add column participant_id uuid references public.record_participants(id);
alter table public.notifications add column request_id uuid references public.record_requests(id);
-- Workflow notices must not be deduplicated by record/day: two requests are distinct.
drop index public.notifications_daily_dedupe_idx;
alter table public.notifications alter column kind type text using kind::text;
create unique index notifications_daily_dedupe_idx on public.notifications
  (user_id,record_id,kind,((created_at at time zone 'Asia/Tehran')::date))
  where kind in ('three_days','tomorrow','today','overdue');
alter table public.record_events drop constraint record_events_event_type_check;
alter table public.record_events add constraint record_events_event_type_check check (event_type in (
  'record_created','share_link_created','receipt_confirmed','extension_requested','repayment_recorded',
  'repayment_confirmed','item_returned','link_revoked','reminder_sent','due_date_changed',
  'return_requested','return_confirmed','member_joined','request_created','request_approved','request_rejected','shares_configured'));

create or replace function public.can_access_record(target_record_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from records where id=target_record_id and creator_id=auth.uid())
  or exists(select 1 from record_participants where record_id=target_record_id
    and user_id=auth.uid() and membership_status='accepted');
$$;
-- Authoritative writes only through the transaction functions. No direct client
-- can accept a member, fabricate a repayment, or overwrite a decision using REST.
revoke insert,update,delete on public.records, public.record_participants, public.repayments,
  public.record_events, public.share_links, public.payment_cards from anon, authenticated;
revoke all on public.payment_cards from anon,authenticated;
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
alter table public.record_requests enable row level security;
create policy "own or managed requests" on public.record_requests for select to authenticated
  using (requester_id=auth.uid() or public.is_record_creator(record_id));
grant select on public.record_requests to authenticated;
revoke insert,update,delete on public.record_requests from anon,authenticated;
drop policy "read accessible participants" on public.record_participants;
create policy "read accessible participants" on public.record_participants for select to authenticated
  using (public.can_access_record(record_id));

create function public.workflow_notice(p_record uuid,p_user uuid,p_kind text,p_title text,p_body text,p_request uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_user is not null then
    insert into notifications(user_id,record_id,kind,title,body,request_id)
    values(p_user,p_record,p_kind,p_title,left(p_body,500),p_request);
  end if;
end $$;

create function public.claim_share_link(p_actor uuid,p_hash text,p_participant uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l share_links; r records; p record_participants; q record_requests; qid uuid;
begin
  select * into l from share_links where token_hash=p_hash;
  if not found then raise exception 'لینک در دسترس نیست.'; end if;
  select * into r from records where id=l.record_id for update;
  -- Existing access wins over expiration/revocation; a link never owns membership.
  if r.creator_id=p_actor then return jsonb_build_object('recordId',r.id,'role','creator','status','accepted'); end if;
  select * into p from record_participants where record_id=r.id and user_id=p_actor and membership_status='accepted';
  if found then return jsonb_build_object('recordId',r.id,'role',p.role,'status','accepted'); end if;
  select * into q from record_requests where record_id=r.id and requester_id=p_actor and kind='membership' and status='pending';
  if found then return jsonb_build_object('recordId',r.id,'status','pending','requestId',q.id); end if;
  -- Re-read under the record lock, shared with revoke-share-link.
  select * into l from share_links where id=l.id;
  if l.revoked_at is not null or l.expires_at <= now() then raise exception 'این دعوت لغو شده یا منقضی شده است.'; end if;
  if r.status in ('completed','cancelled') then raise exception 'این بده‌بستان بسته شده است.'; end if;
  if r.kind='expense' then
    if not r.shares_configured then raise exception 'سازنده باید ابتدا افراد و سهم‌ها را مشخص کند.'; end if;
    if p_participant is null then
      return jsonb_build_object('status','choose-share','recordId',r.id,'shares',coalesce((
        select jsonb_agg(jsonb_build_object('id',id,'name',display_name)) from record_participants
        where record_id=r.id and user_id is null),'[]'::jsonb));
    end if;
    select * into p from record_participants where id=p_participant and record_id=r.id and user_id is null;
    if not found then raise exception 'این سهم دیگر قابل انتخاب نیست.'; end if;
    insert into record_requests(record_id,requester_id,participant_id,kind,idempotency_key)
      values(r.id,p_actor,p.id,'membership',gen_random_uuid()) returning id into qid;
    perform workflow_notice(r.id,r.creator_id,'membership_requested','درخواست عضویت',p.display_name||' درخواست اتصال به سهم را ثبت کرد.',qid);
    insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'request_created',jsonb_build_object('requestId',qid,'kind','membership'));
    return jsonb_build_object('recordId',r.id,'status','pending','requestId',qid);
  end if;
  if exists(select 1 from record_participants where record_id=r.id and user_id is not null) then
    raise exception 'گیرندهٔ این بده‌بستان قبلاً مشخص شده است.';
  end if;
  select * into p from record_participants where record_id=r.id order by created_at,id limit 1;
  if not found then raise exception 'گیرندهٔ رکورد مشخص نشده است.'; end if;
  update record_participants set user_id=p_actor,membership_status='accepted',confirmed_at=now() where id=p.id;
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'member_joined',jsonb_build_object('participantId',p.id));
  perform workflow_notice(r.id,r.creator_id,'member_joined','گیرنده متصل شد',p.display_name||' به بده‌بستان متصل شد.');
  perform workflow_notice(r.id,p_actor,'member_joined','بده‌بستان اضافه شد','این مورد در صفحهٔ اصلی شما در دسترس است.');
  return jsonb_build_object('recordId',r.id,'role','recipient','status','accepted');
end $$;

create function public.create_record_request(p_actor uuid,p_record uuid,p_kind text,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r records; p record_participants; q record_requests; value numeric; balance numeric; due timestamptz; rid uuid;
begin
  select * into r from records where id=p_record for update;
  if not found then raise exception 'بده‌بستان پیدا نشد.'; end if;
  select * into q from record_requests where requester_id=p_actor and idempotency_key=p_key;
  if found then
    if q.record_id<>p_record or q.kind<>p_kind then raise exception 'شناسهٔ تکرار متعلق به عملیات دیگری است.'; end if;
    return to_jsonb(q);
  end if;
  select * into p from record_participants where record_id=r.id and user_id=p_actor and membership_status='accepted';
  if not found and r.creator_id<>p_actor then raise exception 'دسترسی غیرمجاز است.'; end if;
  if r.status in ('completed','cancelled') then raise exception 'این بده‌بستان بسته شده است.'; end if;
  if p_kind not in ('extension','return','payment') then raise exception 'نوع درخواست معتبر نیست.'; end if;
  if r.creator_id=p_actor and p_kind<>'payment' then raise exception 'این درخواست برای گیرنده است.'; end if;
  if p_kind='return' and r.kind<>'item' then raise exception 'بازگشت فقط برای امانت است.'; end if;
  if p_kind='extension' then
    due := (p_payload->>'dueAt')::timestamptz;
    if due is null or due<=now() or due<=r.due_at or due>now()+interval '10 years' then raise exception 'موعد جدید باید پس از موعد فعلی و امروز باشد.'; end if;
    p_payload:=jsonb_build_object('dueAt',due,'note',left(coalesce(p_payload->>'note',''),500));
  elsif p_kind='payment' then
    if r.kind='item' then raise exception 'پرداخت برای قرض یا دنگ است.'; end if;
    if r.creator_id=p_actor and r.kind='expense' then
      select * into p from record_participants where id=(p_payload->>'participantId')::uuid and record_id=r.id;
      if not found or p.share_amount is null then raise exception 'سهم پرداخت‌کننده را مشخص کنید.'; end if;
    elsif r.creator_id=p_actor then
      select * into p from record_participants where record_id=r.id order by created_at,id limit 1;
    end if;
    value:=(p_payload->>'amount')::numeric;
    if value is null or value<>trunc(value) or value<=0 or value>99999999999999 then raise exception 'مبلغ معتبر نیست.'; end if;
    select coalesce(case when r.kind='expense' then p.share_amount else r.amount end,0)-coalesce(sum(amount),0)
      into balance from repayments where record_id=r.id and status='confirmed' and (r.kind<>'expense' or participant_id=p.id);
    if value>balance then raise exception 'مبلغ بیشتر از مانده است.'; end if;
    if nullif(p_payload->>'receiptPath','') is not null then
      if not starts_with(p_payload->>'receiptPath',p_actor::text||'/'||r.id::text||'/')
        or nullif(p_payload->>'receiptName','') is null
        or coalesce(p_payload->>'receiptMime','') not in ('image/jpeg','image/png','image/webp','application/pdf')
        then raise exception 'رسید معتبر نیست.'; end if;
      if not exists(select 1 from storage.objects where bucket_id='receipts' and name=p_payload->>'receiptPath') then raise exception 'فایل رسید بارگذاری نشده است.'; end if;
    end if;
  end if;
  insert into record_requests(record_id,requester_id,participant_id,kind,payload,idempotency_key)
    values(r.id,p_actor,p.id,p_kind,p_payload,p_key) returning * into q;
  if p_kind='payment' then
    insert into repayments(record_id,request_id,participant_id,amount,payer_name,note,receipt_path,receipt_name,receipt_mime)
      values(r.id,q.id,p.id,value,coalesce(p.display_name,'پرداخت‌کننده'),left(p_payload->>'note',500),
        nullif(p_payload->>'receiptPath',''),left(nullif(p_payload->>'receiptName',''),180),nullif(p_payload->>'receiptMime',''));
  end if;
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'request_created',jsonb_build_object('requestId',q.id,'kind',p_kind));
  perform workflow_notice(r.id,r.creator_id,'request_created','درخواست تازه',case p_kind when 'extension' then 'درخواست تمدید موعد' when 'return' then 'اعلام بازگشت امانت' else 'پرداخت در انتظار تأیید' end,q.id);
  return to_jsonb(q);
end $$;

create function public.respond_record_request(p_actor uuid,p_request uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q record_requests; r records; p record_participants; pay repayments; used numeric; other record_requests;
begin
  if p_decision not in ('approved','rejected') then raise exception 'تصمیم معتبر نیست.'; end if;
  select * into q from record_requests where id=p_request;
  if not found then raise exception 'درخواست پیدا نشد.'; end if;
  select * into r from records where id=q.record_id for update;
  if r.creator_id<>p_actor then raise exception 'فقط سازنده می‌تواند تصمیم بگیرد.'; end if;
  select * into q from record_requests where id=p_request for update;
  if q.status<>'pending' then return to_jsonb(q); end if;
  if p_decision='approved' then
    if r.status in ('completed','cancelled') then raise exception 'این بده‌بستان بسته شده؛ درخواست را رد کنید.'; end if;
    if q.kind='membership' then
      if q.requester_id is null then raise exception 'حساب درخواست‌کننده حذف شده است.'; end if;
      select * into p from record_participants where id=q.participant_id for update;
      if p.user_id is not null then raise exception 'این سهم به حساب دیگری متصل شده است.'; end if;
      update record_participants set user_id=q.requester_id,membership_status='accepted',confirmed_at=now() where id=p.id;
      -- Competing claims are rejected explicitly, with their own result notices.
      for other in select * from record_requests where participant_id=p.id and kind='membership' and status='pending' and id<>q.id loop
        update record_requests set status='rejected',decided_at=now(),decided_by=p_actor where id=other.id;
        insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'request_rejected',jsonb_build_object('requestId',other.id));
        perform workflow_notice(r.id,other.requester_id,'request_result','درخواست عضویت رد شد','این سهم به حساب دیگری متصل شده است.',other.id);
      end loop;
    elsif q.kind='extension' then
      if (q.payload->>'dueAt')::timestamptz<=now() or (q.payload->>'dueAt')::timestamptz<=r.due_at then raise exception 'موعد این درخواست قدیمی شده است؛ درخواست را رد کنید.'; end if;
      update records set due_at=(q.payload->>'dueAt')::timestamptz,status='active' where id=r.id;
    elsif q.kind='return' then
      update records set status='completed',completed_at=now() where id=r.id;
    elsif q.kind='payment' then
      select * into pay from repayments where request_id=q.id for update;
      if not found then raise exception 'پرداخت درخواست پیدا نشد.'; end if;
      select coalesce(sum(amount),0) into used from repayments where record_id=r.id and status='confirmed';
      if pay.amount>r.amount-used then raise exception 'پرداخت بیشتر از ماندهٔ فعلی است.'; end if;
      if r.kind='expense' and pay.participant_id is not null then
        select * into p from record_participants where id=pay.participant_id;
        if pay.amount>p.share_amount-(select coalesce(sum(amount),0) from repayments where participant_id=p.id and status='confirmed') then raise exception 'پرداخت بیشتر از ماندهٔ سهم است.'; end if;
      end if;
      update repayments set status='confirmed',confirmed_at=now(),confirmed_by=p_actor where id=pay.id;
      if used+pay.amount=r.amount then update records set status='completed',completed_at=now() where id=r.id; end if;
    end if;
  elsif q.kind='payment' then
    update repayments set status='rejected' where request_id=q.id;
  end if;
  update record_requests set status=p_decision,decided_at=now(),decided_by=p_actor where id=q.id returning * into q;
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'request_'||p_decision,jsonb_build_object('requestId',q.id,'kind',q.kind));
  perform workflow_notice(r.id,q.requester_id,'request_result',case when p_decision='approved' then 'درخواست تأیید شد' else 'درخواست رد شد' end,r.title,q.id);
  return to_jsonb(q);
end $$;

-- Preserve old payment state, attach a stable request ID instead of inventing
-- request histories from unstructured events. Old extension/return events remain history.
insert into record_requests(id,record_id,requester_id,kind,status,payload,idempotency_key,created_at,decided_at,decided_by)
select p.id,p.record_id,r.creator_id,'payment',case p.status when 'confirmed' then 'approved' when 'rejected' then 'rejected' else 'pending' end,
  jsonb_build_object('amount',p.amount,'legacy',true),p.id,p.recorded_at,p.confirmed_at,p.confirmed_by
from repayments p join records r on r.id=p.record_id;
update repayments set request_id=id;

create function public.workflow_dashboard(p_actor uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('records',coalesce((select jsonb_agg(data order by created_at desc) from (
  select r.created_at, to_jsonb(r) || jsonb_build_object(
    'role',case when r.creator_id=p_actor then 'creator' else me.role::text end,
    'creator_name',coalesce((select display_name from profiles where id=r.creator_id),'سازنده'),
    'viewer_amount',case when r.creator_id<>p_actor and r.kind='expense' then me.share_amount else r.amount end,
    'participant_id',me.id,
    'permissions',jsonb_build_object('manage',r.creator_id=p_actor,'request',r.creator_id<>p_actor and r.status not in ('completed','cancelled'),
      'pay',r.kind<>'item' and r.status not in ('completed','cancelled'),'card',true),
    'record_participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'role',p.role,'membership_status',p.membership_status,'share_amount',p.share_amount,'confirmed_at',p.confirmed_at)) from record_participants p where p.record_id=r.id),'[]'::jsonb),
    'payment_cards',coalesce((select jsonb_agg(jsonb_build_object('last4',last4,'bank_name',bank_name)) from payment_cards where record_id=r.id),'[]'::jsonb),
    'repayments',coalesce((select jsonb_agg(to_jsonb(pay) order by pay.recorded_at desc) from repayments pay where pay.record_id=r.id and (r.creator_id=p_actor or r.kind<>'expense' or pay.participant_id=me.id)),'[]'::jsonb),
    'share_links',case when r.creator_id=p_actor then coalesce((select jsonb_agg(jsonb_build_object('id',id,'expires_at',expires_at,'revoked_at',revoked_at)) from share_links where record_id=r.id),'[]'::jsonb) else '[]'::jsonb end,
    'record_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from record_events e where e.record_id=r.id),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from record_requests q where q.record_id=r.id and (r.creator_id=p_actor or q.requester_id=p_actor)),'[]'::jsonb)
  ) as data from records r left join record_participants me on me.record_id=r.id and me.user_id=p_actor and me.membership_status='accepted'
  where r.creator_id=p_actor or me.id is not null
) visible),'[]'::jsonb),
'membershipRequests',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'recordId',q.record_id,'status',q.status,'name',p.display_name)) from record_requests q
  join record_participants p on p.id=q.participant_id where q.requester_id=p_actor and q.kind='membership'),'[]'::jsonb));
$$;

-- Realtime uses authenticated sessions and the same SELECT policies as REST.
do $$ declare t text; begin
  foreach t in array array['records','record_participants','record_requests','repayments','record_events','notifications','notification_preferences'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
revoke all on function public.workflow_notice(uuid,uuid,text,text,text,uuid),
  public.claim_share_link(uuid,text,uuid),public.create_record_request(uuid,uuid,text,jsonb,uuid),
  public.respond_record_request(uuid,uuid,text),public.workflow_dashboard(uuid) from public,anon,authenticated;
grant execute on function public.workflow_notice(uuid,uuid,text,text,text,uuid),
  public.claim_share_link(uuid,text,uuid),public.create_record_request(uuid,uuid,text,jsonb,uuid),
  public.respond_record_request(uuid,uuid,text),public.workflow_dashboard(uuid) to service_role;
