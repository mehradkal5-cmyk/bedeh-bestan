-- Personal expense codes are short-lived and consumed by the first valid claim.
alter table public.share_invite_codes add column if not exists expires_at timestamptz;
update public.share_invite_codes set expires_at=issued_at+interval '24 hours' where expires_at is null;
alter table public.share_invite_codes alter column expires_at set default now()+interval '24 hours';
alter table public.share_invite_codes alter column expires_at set not null;

create or replace function public.issue_share_code(p_actor uuid,p_record uuid,p_participant uuid,p_hash text)
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
  insert into share_invite_codes(participant_id,code_hash,expires_at) values(p.id,p_hash,now()+interval '24 hours')
    on conflict(participant_id) do update set code_hash=excluded.code_hash,issued_at=now(),expires_at=excluded.expires_at;
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'share_code_issued',jsonb_build_object('participantId',p.id));
  return jsonb_build_object('name',p.display_name,'expiresAt',now()+interval '24 hours');
end $$;

create or replace function public.claim_share_link(p_actor uuid,p_hash text,p_participant uuid,p_code_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l share_links; r records; p record_participants; q record_requests; qid uuid; invite share_invite_codes;
begin
  select * into l from share_links where token_hash=p_hash;
  if not found then raise exception 'لینک در دسترس نیست.'; end if;
  select * into r from records where id=l.record_id for update;
  if r.creator_id=p_actor then return jsonb_build_object('recordId',r.id,'role','creator','status','accepted'); end if;
  select * into p from record_participants where record_id=r.id and user_id=p_actor and membership_status='accepted';
  if found then return jsonb_build_object('recordId',r.id,'role',p.role,'status','accepted'); end if;
  select * into q from record_requests where record_id=r.id and requester_id=p_actor and kind='membership' and status='pending';
  if found and q.membership_code_verified then return jsonb_build_object('recordId',r.id,'status','pending','requestId',q.id); end if;
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
    if p_code_hash is null then raise exception 'کد اختصاصی این سهم را از سازنده بگیر.'; end if;
    select * into invite from share_invite_codes where participant_id=p.id for update;
    if not found or invite.code_hash<>p_code_hash or invite.expires_at<=now() then
      raise exception 'کد اختصاصی اشتباه یا منقضی است؛ از سازنده کد تازه بگیر.';
    end if;
    if q.id is not null then
      if q.participant_id<>p.id then raise exception 'برای سهم دیگری درخواست باز داری؛ از سازنده بخواه آن را رد کند.'; end if;
      update record_requests set membership_code_verified=true where id=q.id;
      qid := q.id;
    else
      insert into record_requests(record_id,requester_id,participant_id,kind,idempotency_key,membership_code_verified)
        values(r.id,p_actor,p.id,'membership',gen_random_uuid(),true) returning id into qid;
    end if;
    delete from share_invite_codes where participant_id=p.id;
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
