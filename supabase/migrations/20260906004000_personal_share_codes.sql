-- Personal invitation secrets never enter the Realtime/public participant rows.
create table public.share_invite_codes (
  participant_id uuid primary key references public.record_participants(id) on delete cascade,
  code_hash text not null check(length(code_hash)=64),
  issued_at timestamptz not null default now()
);
alter table public.share_invite_codes enable row level security;
revoke all on public.share_invite_codes from public,anon,authenticated;
alter table public.record_requests add column membership_code_verified boolean not null default false;
alter table public.record_events drop constraint record_events_event_type_check;
alter table public.record_events add constraint record_events_event_type_check check (event_type in (
  'record_created','share_link_created','receipt_confirmed','extension_requested','repayment_recorded',
  'repayment_confirmed','item_returned','link_revoked','reminder_sent','due_date_changed',
  'return_requested','return_confirmed','member_joined','request_created','request_approved','request_rejected','shares_configured','share_code_issued'));

create function public.issue_share_code(p_actor uuid,p_record uuid,p_participant uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r records; p record_participants;
begin
  select * into r from records where id=p_record for update;
  if not found or r.creator_id<>p_actor or r.kind<>'expense' then raise exception 'فقط سازندهٔ دنگ می‌تواند کد بسازد.'; end if;
  if not r.shares_configured or r.status in ('completed','cancelled') then raise exception 'دعوت این دنگ آماده نیست.'; end if;
  select * into p from record_participants where id=p_participant and record_id=r.id and user_id is null;
  if not found then raise exception 'این سهم قابل دعوت نیست.'; end if;
  if exists(select 1 from record_requests where participant_id=p.id and kind='membership' and status='pending' and membership_code_verified) then
    raise exception 'اول درخواست باز این سهم را تأیید یا رد کن.';
  end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'کد معتبر نیست.'; end if;
  insert into share_invite_codes(participant_id,code_hash) values(p.id,p_hash)
    on conflict(participant_id) do update set code_hash=excluded.code_hash,issued_at=now();
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'share_code_issued',jsonb_build_object('participantId',p.id));
  return jsonb_build_object('name',p.display_name);
end $$;
revoke all on function public.issue_share_code(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_share_code(uuid,uuid,uuid,text) to service_role;

create function public.claim_share_link(p_actor uuid,p_hash text,p_participant uuid,p_code_hash text)
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
  if found and q.membership_code_verified then return jsonb_build_object('recordId',r.id,'status','pending','requestId',q.id); end if;
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
    if p_code_hash is null or not exists(select 1 from share_invite_codes where participant_id=p.id and code_hash=p_code_hash) then
      raise exception 'کد اختصاصی این سهم درست نیست؛ از سازنده بگیر.';
    end if;
    if q.id is not null then
      if q.participant_id<>p.id then raise exception 'برای سهم دیگری درخواست باز داری؛ از سازنده بخواه آن را رد کند.'; end if;
      update record_requests set membership_code_verified=true where id=q.id;
      qid := q.id;
    else
      insert into record_requests(record_id,requester_id,participant_id,kind,idempotency_key,membership_code_verified)
        values(r.id,p_actor,p.id,'membership',gen_random_uuid(),true) returning id into qid;
    end if;
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


-- Existing frontends retain item/money claims and existing memberships. Expense
-- claims require the new personal code; no insecure legacy endpoint remains.
create or replace function public.claim_share_link(p_actor uuid,p_hash text,p_participant uuid default null)
returns jsonb language sql security definer set search_path=public as $$
select public.claim_share_link(p_actor,p_hash,p_participant,null::text);
$$;
revoke all on function public.claim_share_link(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_share_link(uuid,text,uuid,text) to service_role;

create or replace function public.respond_record_request(p_actor uuid,p_request uuid,p_decision text)
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
      if not q.membership_code_verified then raise exception 'این درخواست قدیمی است؛ درخواست‌کننده باید دوباره لینک را با کد اختصاصی باز کند.'; end if;
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
  perform workflow_notice(r.id,q.requester_id,'request_result',case when p_decision='approved' then 'درخواست تأیید شد' else 'درخواست رد شد' end,case when q.kind='membership' and p_decision='rejected' then 'سازنده درخواست عضویت شما را نپذیرفت.' else r.title end,q.id);
  return to_jsonb(q);
end $$;

create or replace function public.workflow_dashboard(p_actor uuid)
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
    'requests',coalesce((select jsonb_agg((to_jsonb(q)||jsonb_build_object('requester_email',case when r.creator_id=p_actor then (select email from auth.users where id=q.requester_id) else null end)) order by q.created_at desc) from record_requests q where q.record_id=r.id and (r.creator_id=p_actor or q.requester_id=p_actor)),'[]'::jsonb)
  ) as data from records r left join record_participants me on me.record_id=r.id and me.user_id=p_actor and me.membership_status='accepted'
  where r.creator_id=p_actor or me.id is not null
) visible),'[]'::jsonb),
'membershipRequests',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'recordId',q.record_id,'status',q.status,'name',p.display_name)) from record_requests q
  join record_participants p on p.id=q.participant_id where q.requester_id=p_actor and q.kind='membership'),'[]'::jsonb));
$$;
