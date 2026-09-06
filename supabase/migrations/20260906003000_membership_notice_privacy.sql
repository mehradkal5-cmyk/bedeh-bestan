-- A rejected membership never reveals the private record title.
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

create or replace function public.create_record_request(p_actor uuid,p_record uuid,p_kind text,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r records; p record_participants; q record_requests; value numeric; balance numeric; due timestamptz;
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

create or replace function public.workflow_command(p_actor uuid,p_action text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r records; rid uuid; lid uuid; target share_links; member record;
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
