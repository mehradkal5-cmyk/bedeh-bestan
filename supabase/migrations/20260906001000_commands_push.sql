create function public.configure_record_shares(p_actor uuid,p_record uuid,p_shares jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r records; part jsonb; total numeric; count_names integer;
begin
  select * into r from records where id=p_record for update;
  if not found or r.creator_id<>p_actor or r.kind<>'expense' then raise exception 'دسترسی غیرمجاز است.'; end if;
  if jsonb_typeof(p_shares)<>'array' or jsonb_array_length(p_shares) not between 1 and 100 then raise exception 'افراد و سهم‌ها را مشخص کنید.'; end if;
  if exists(select 1 from record_participants where record_id=r.id and user_id is not null)
    or exists(select 1 from record_requests where record_id=r.id and kind='membership') then raise exception 'سهم‌های دعوت‌شده قابل جایگزینی نیستند.'; end if;
  if exists(select 1 from repayments where record_id=r.id) then raise exception 'این دنگ سابقهٔ پرداخت دارد؛ برای حفظ مانده، سهم‌ها نیاز به تطبیق جداگانه دارند.'; end if;
  select sum((value->>'amount')::numeric),count(distinct trim(value->>'name')) into total,count_names from jsonb_array_elements(p_shares);
  if total is distinct from r.amount or count_names<>jsonb_array_length(p_shares) then raise exception 'نام‌ها باید یکتا و جمع سهم‌ها برابر مبلغ کل باشد.'; end if;
  for part in select value from jsonb_array_elements(p_shares) loop
    if char_length(trim(coalesce(part->>'name',''))) not between 1 and 80 or
      (part->>'amount')::numeric<=0 or (part->>'amount')::numeric<>trunc((part->>'amount')::numeric) or part->>'amount' is null then raise exception 'نام یا مبلغ سهم معتبر نیست.'; end if;
  end loop;
  -- The exact old string is preserved in the event before replacing unclaimed rows.
  insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'shares_configured',
    jsonb_build_object('previousParticipants',(select jsonb_agg(to_jsonb(p)) from record_participants p where record_id=r.id)));
  delete from record_participants where record_id=r.id;
  insert into record_participants(record_id,display_name,role,share_amount)
    select r.id,trim(value->>'name'),'contributor',(value->>'amount')::numeric from jsonb_array_elements(p_shares);
  update records set shares_configured=true where id=r.id;
end $$;

create function public.workflow_command(p_actor uuid,p_action text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r records; rid uuid; lid uuid; target share_links; part record_participants; q record_requests; value numeric; member record;
begin
  if p_action='create-record' then
    insert into records(creator_id,kind,title,amount,currency,due_at,notes)
      values(p_actor,(p->>'kind')::record_kind,p->>'title',(p->>'amount')::numeric,p->>'currency',(p->>'dueAt')::timestamptz,p->>'notes') returning * into r;
    insert into record_participants(record_id,display_name,role) values(r.id,p->>'recipientName',case when r.kind='expense' then 'contributor'::participant_role else 'recipient'::participant_role end);
    if p->'card' is not null and p->'card'<>'null'::jsonb then
      insert into payment_cards(record_id,owner_id,encrypted_number,encryption_iv,key_version,last4,bank_name)
        values(r.id,p_actor,p->'card'->>'encrypted_number',p->'card'->>'encryption_iv',1,p->'card'->>'last4',p->'card'->>'bank_name');
    end if;
    insert into record_events(record_id,actor_id,event_type) values(r.id,p_actor,'record_created');
    if r.kind='expense' and p->'shares' is not null and p->'shares'<>'null'::jsonb then perform configure_record_shares(p_actor,r.id,p->'shares'); end if;
    return jsonb_build_object('id',r.id);
  end if;
  if p_action='revoke-share-link' then
    select * into target from share_links where id=(p->>'linkId')::uuid;
    rid:=target.record_id;
  else rid:=(p->>'recordId')::uuid; end if;
  select * into r from records where id=rid for update;
  if not found or r.creator_id<>p_actor then raise exception 'دسترسی غیرمجاز است.'; end if;
  if p_action='configure-shares' then
    perform configure_record_shares(p_actor,r.id,p->'shares');
  elsif p_action='create-share-link' then
    if r.status in ('completed','cancelled') then raise exception 'این بده‌بستان بسته شده است.'; end if;
    if r.kind='expense' and not r.shares_configured then raise exception 'پیش از دعوت، افراد و سهم‌ها را مشخص کنید.'; end if;
    -- Exactly one active invitation; all contributors use this common link.
    update share_links set revoked_at=now() where record_id=r.id and revoked_at is null;
    insert into share_links(record_id,created_by,token_hash,expires_at)
      values(r.id,p_actor,p->>'tokenHash',(p->>'expiresAt')::timestamptz) returning id into lid;
    insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'share_link_created',jsonb_build_object('linkId',lid));
    return jsonb_build_object('id',lid,'expiresAt',p->>'expiresAt');
  elsif p_action='revoke-share-link' then
    if target.revoked_at is null then
      update share_links set revoked_at=now() where id=target.id;
      insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,'link_revoked',jsonb_build_object('linkId',target.id));
    end if;
  elsif p_action='change-due-date' or p_action='mark-returned' then
    if r.status in ('completed','cancelled') then raise exception 'این بده‌بستان بسته شده است.'; end if;
    if p_action='mark-returned' then
      if r.kind<>'item' then raise exception 'بازگشت فقط برای امانت است.'; end if;
      update records set status='completed',completed_at=now() where id=r.id;
    else
      if (p->>'dueAt')::timestamptz is null or (p->>'dueAt')::timestamptz<=now() then raise exception 'موعد معتبر نیست.'; end if;
      update records set due_at=(p->>'dueAt')::timestamptz,status='active' where id=r.id;
    end if;
    insert into record_events(record_id,actor_id,event_type,metadata) values(r.id,p_actor,case when p_action='mark-returned' then 'item_returned' else 'due_date_changed' end,p);
    for member in select user_id from record_participants where record_id=r.id and membership_status='accepted' and user_id is not null loop
      perform workflow_notice(r.id,member.user_id,'record_changed','بده‌بستان به‌روز شد',r.title);
    end loop;
  else raise exception 'عملیات معتبر نیست.';
  end if;
  return jsonb_build_object('id',r.id);
end $$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,endpoint text not null unique,subscription jsonb not null,
  enabled boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(user_id,device_id)
);
create table public.push_jobs (
  id uuid primary key default gen_random_uuid(),notification_id uuid not null references notifications(id) on delete cascade,
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
  lease_id uuid,locked_at timestamptz,sent_at timestamptz,last_error text,
  unique(notification_id,subscription_id)
);
create index push_jobs_due_idx on push_jobs(next_attempt_at) where status in ('pending','sending');
alter table public.push_subscriptions enable row level security;
alter table public.push_jobs enable row level security;
create policy "own push devices" on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
revoke all on public.push_jobs from anon,authenticated;
revoke insert,update,delete on public.push_subscriptions from anon,authenticated;

create function public.enqueue_notification_push() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into push_jobs(notification_id,subscription_id)
    select new.id,s.id from push_subscriptions s join notification_preferences p on p.user_id=s.user_id
    where s.user_id=new.user_id and s.enabled and p.push_enabled;
  return new;
end $$;
create trigger notification_push after insert on notifications for each row execute function enqueue_notification_push();

create function public.lease_push_jobs(p_limit integer default 30)
returns setof public.push_jobs language sql security definer set search_path=public as $$
  update push_jobs j set status='sending',lease_id=gen_random_uuid(),locked_at=now(),attempts=attempts+1
  where id in (select id from push_jobs where (status='pending' and next_attempt_at<=now()) or
    (status='sending' and locked_at<now()-interval '5 minutes') order by next_attempt_at for update skip locked limit least(p_limit,50)) returning j.*;
$$;

create function public.finish_push_job(p_id uuid,p_lease uuid,p_success boolean,p_terminal boolean,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare j push_jobs;
begin
  select * into j from push_jobs where id=p_id and lease_id=p_lease and status='sending' for update;
  if not found then return; end if;
  update push_jobs set status=case when p_success then 'sent' when p_terminal or attempts>=8 then 'failed' else 'pending' end,
    sent_at=case when p_success then now() else null end,last_error=left(p_error,250),
    next_attempt_at=now()+make_interval(secs=>least(21600,(30*power(2,least(attempts,10)))::integer)),locked_at=null,lease_id=null where id=j.id;
  update notifications set delivery=case when p_success or delivery='push_sent' then 'push_sent'::delivery_state else 'push_failed'::delivery_state end,
    delivery_attempted_at=now() where id=j.notification_id;
end $$;

create function public.register_push_device(p_actor uuid,p_device uuid,p_subscription jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- A browser subscription can belong to only the currently signed-in account.
  delete from push_subscriptions where endpoint=p_subscription->>'endpoint' and user_id<>p_actor;
  insert into push_subscriptions(user_id,device_id,endpoint,subscription) values(p_actor,p_device,p_subscription->>'endpoint',p_subscription)
  on conflict(user_id,device_id) do update set endpoint=excluded.endpoint,subscription=excluded.subscription,enabled=true,updated_at=now();
  insert into notification_preferences(user_id,push_enabled) values(p_actor,true)
    on conflict(user_id) do update set push_enabled=true;
end $$;

create function public.create_due_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare today date:=(now() at time zone 'Asia/Tehran')::date; total integer;
begin
  with recipients as (
    select id record_id,creator_id user_id from records
    union select record_id,user_id from record_participants where membership_status='accepted' and user_id is not null
  ), candidates as (
    select r.id,r.title,x.user_id,case (r.due_at at time zone 'Asia/Tehran')::date-today
      when 3 then 'three_days' when 1 then 'tomorrow' when 0 then 'today' else 'overdue' end kind
    from records r join recipients x on x.record_id=r.id left join notification_preferences p on p.user_id=x.user_id
    where r.status in ('active','overdue') and coalesce(p.reminders_enabled,true)
      and ((r.due_at at time zone 'Asia/Tehran')::date-today in (3,1,0) or (r.due_at at time zone 'Asia/Tehran')::date<today)
  ), inserted as (
    insert into notifications(user_id,record_id,kind,title,body)
    select user_id,id,kind,case kind when 'three_days' then 'سه روز تا موعد' when 'tomorrow' then 'موعد فرداست' when 'today' then 'موعد امروز است' else 'موعد گذشته است' end,title
    from candidates on conflict do nothing returning record_id,kind
  ), events as (
    insert into record_events(record_id,event_type,actor_label,metadata)
      select record_id,'reminder_sent','سامانه',jsonb_build_object('kind',kind,'delivery','in_app') from inserted returning id
  ) select count(*) into total from events;
  return total;
end $$;

revoke all on function public.configure_record_shares(uuid,uuid,jsonb),public.workflow_command(uuid,text,jsonb),
  public.enqueue_notification_push(),public.lease_push_jobs(integer),public.finish_push_job(uuid,uuid,boolean,boolean,text),
  public.register_push_device(uuid,uuid,jsonb),public.create_due_reminders() from public,anon,authenticated;
grant execute on function public.configure_record_shares(uuid,uuid,jsonb),public.workflow_command(uuid,text,jsonb),
  public.lease_push_jobs(integer),public.finish_push_job(uuid,uuid,boolean,boolean,text),
  public.register_push_device(uuid,uuid,jsonb),public.create_due_reminders() to service_role;
