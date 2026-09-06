/* One authenticated surface for owners and accepted recipients. Dialogs live
   outside #main, so incoming data never replaces an open form or its files. */
(function () {
  const backend = window.BedehBackend;
  if (!backend?.configured) return;
  const core = window.BedehProductCore;
  const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[c]);
  const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
  const label = { membership: 'عضویت در دنگ', extension: 'تمدید موعد', return: 'بازگشت امانت', payment: 'پرداخت' };
  const statuses = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };
  let user = null, inFlight = null, queued = false, revision = 0, detailId = '';
  let realtime = null, channel = null, connected = false, timer = null, debounce = null, backoff = 5000;
  let notificationsError = '', syncError = '', memberships = [], preferences = {}, invitation = null;
  let started = false, lastData = '', claimBusy = false;
  const tokens = new Map();
  const getRecord = (id) => state.records.find((r) => r.id === id);
  const closed = (r) => ['completed','cancelled','returned','settled'].includes(r.status);
  const date = (value) => value ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year:'numeric', month:'long', day:'numeric' }).format(new Date(value.length === 10 ? value + 'T12:00:00+03:30' : value)) : 'بدون موعد';
  const money = (value, r) => `${fa(value)} ${escape(r.currency)}`;
  const balance = (r) => Math.max(0, r.amount - r.repayments.reduce((sum,p) => sum + p.amount, 0));
  const role = (r) => r.role === 'creator' ? 'سازنده' : r.type === 'item' ? 'امانت‌گیرنده' : r.type === 'expense' ? 'عضو دنگ' : 'قرض‌گیرنده';
  const pending = () => state.records.flatMap((r) => (r.requests || []).filter((q) => q.status === 'pending' && r.permissions?.manage).map((q) => ({ r, q })));

  function rememberInvite(recordId, shared) {
    tokens.set(recordId, shared);
    if (user) sessionStorage.setItem('bedeh-invites-' + user.id, JSON.stringify([...tokens]));
  }

  function parseShares(value) {
    const shares = String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const colon = line.lastIndexOf(':');
      const name = line.slice(0, colon).trim();
      const raw = core.asciiDigits(line.slice(colon + 1)).replace(/[٬,\s]/g, '');
      const amount = Number(raw);
      if (colon < 1 || !name || name.length > 80 || !/^\d+$/.test(raw) || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('هر خط باید شامل نام، دونقطه و مبلغ سهم باشد.');
      return { name, amount };
    });
    if (!shares.length || shares.length > 100 || new Set(shares.map((s) => s.name)).size !== shares.length) throw new Error('بین ۱ تا ۱۰۰ نام یکتا وارد کنید.');
    return shares;
  }

  function requestCard(q, r, canRespond = r?.permissions?.manage) {
    const person = r?.memberShares?.find((p) => p.id === q.participant_id)?.display_name;
    const details = q.kind === 'extension' ? date(q.payload?.dueAt) : q.kind === 'payment' ? money(q.payload?.amount, r) : '';
    return `<article class="workflow-request" data-request-row="${q.id}"><div><strong>${escape(label[q.kind])}${r ? ` · ${escape(r.title)}` : ''}</strong><p>${escape(person || '')}${person && details ? ' · ' : ''}${details}</p><small>${date(q.created_at)}</small></div><div class="workflow-request-actions"><span class="chip ${q.status === 'approved' ? 'done' : q.status === 'rejected' ? 'late' : 'open'}">${statuses[q.status]}</span>${canRespond && q.status === 'pending' ? `<button class="primary-btn" data-decision="approved" data-request="${q.id}">${icon('check')} تأیید</button><button class="secondary-btn" data-decision="rejected" data-request="${q.id}">${icon('x')} رد</button>` : ''}</div></article>`;
  }

  function recordCards(records) {
    if (!records.length) return '<p class="empty">موردی در این بخش ندارید.</p>';
    return `<div class="record-list">${records.map((r) => `<article class="record-card"><div class="record-card-top"><span class="type-label">${typeName(r.type)} · ${role(r)}</span><span class="chip ${closed(r) ? 'done' : 'open'}">${closed(r) ? 'بسته‌شده' : 'فعال'}</span></div><h3>${escape(r.title)}</h3><p>طرف مقابل: ${escape(r.person)}</p><p>${r.type === 'item' ? 'امانت' : `مانده${r.role === 'contributor' ? 'ٔ سهم شما' : ''}: ${money(balance(r), r)}`}</p><div class="record-card-foot"><span>${date(r.due)}</span><button class="text-btn" data-record="${r.id}">مشاهده ${icon('arrow-left')}</button></div></article>`).join('')}</div>`;
  }

  function home() {
    const open = state.records.filter((r) => !closed(r));
    const sum = (owner) => open.filter((r) => r.type !== 'item' && (r.role === 'creator') === owner).reduce((s,r) => s + balance(r) / (r.currency === 'ریال' ? 10 : 1), 0);
    const list = active === 'records' && window.filter ? state.records.filter((r) => r.type === window.filter) : state.records;
    const requests = pending();
    return `<div class="page-head"><h1>${active === 'records' ? 'بده‌بستان‌ها' : 'خانه'}</h1><button class="primary-btn" data-action="new-record">${icon('plus')} ثبت بده‌بستان</button></div>
      ${active === 'home' ? `<section class="stats"><div class="stat"><small>به من بدهکارند</small><strong>${fa(sum(true))}</strong><small>تومان</small></div><div class="stat"><small>من بدهکارم</small><strong>${fa(sum(false))}</strong><small>تومان</small></div><div class="stat"><small>امانت‌های باز</small><strong>${fa(open.filter((r) => r.type === 'item').length)}</strong><small>مورد</small></div></section>` : `<div class="tabs">${[['','همه'],['item','امانت'],['money','قرض'],['expense','دنگ']].map(([key,text]) => `<button class="tab ${window.filter === key ? 'active' : ''}" data-workflow-filter="${key}">${text}</button>`).join('')}</div>`}
      ${requests.length ? `<section class="section"><h2>نیازمند تصمیم شما <span class="chip open">${fa(requests.length)}</span></h2>${requests.map(({r,q}) => requestCard(q,r)).join('')}</section>` : ''}
      ${memberships.filter((q) => q.status !== 'approved').map((q) => `<div class="workflow-status">درخواست عضویت برای ${escape(q.name)}: ${statuses[q.status]}${q.status === 'pending' ? '؛ پس از تأیید سازنده، بده‌بستان اینجا نمایش داده می‌شود.' : ''}</div>`).join('')}
      <section class="section"><h2>ساخته‌شده توسط من</h2>${recordCards(list.filter((r) => r.role === 'creator'))}</section><section class="section"><h2>دریافت‌شده توسط من</h2>${recordCards(list.filter((r) => r.role !== 'creator'))}</section>`;
  }

  function detailPage(r) {
    const manage = r.permissions?.manage;
    return `<button class="back" data-go="home">${icon('arrow-right')} بازگشت به خانه</button><div class="detail-head"><div><h1 class="detail-title">${escape(r.title)}</h1><p>${typeName(r.type)} · نقش شما: ${role(r)}</p></div><span class="chip ${closed(r) ? 'done' : 'open'}">${closed(r) ? 'بسته‌شده' : 'فعال'}</span></div>
      <div class="detail-grid"><section class="info-block"><h2>جزئیات</h2><div class="info-row"><span>طرف مقابل</span><b>${escape(r.person)}</b></div><div class="info-row"><span>موعد</span><b>${date(r.due)}</b></div>${r.type !== 'item' ? `<div class="info-row"><span>${r.role === 'contributor' ? 'سهم شما' : 'مبلغ اولیه'}</span><b>${money(r.amount,r)}</b></div><div class="info-row"><span>پرداخت تأییدشده</span><b>${money(r.amount-balance(r),r)}</b></div><div class="info-row"><span>مانده</span><b>${money(balance(r),r)}</b></div>` : ''}${r.note ? `<p>${escape(r.note)}</p>` : ''}
      <div class="actions">${manage && !closed(r) ? `<button class="primary-btn" data-invite="${r.id}">${icon('qr-code')} لینک و QR</button><button class="secondary-btn" data-owner-action="${r.type === 'item' ? 'mark-returned' : 'change-due-date'}" data-id="${r.id}">${r.type === 'item' ? 'ثبت بازگشت' : 'تغییر موعد'}</button>` : ''}${r.permissions?.request ? `<button class="secondary-btn" data-request-kind="extension" data-id="${r.id}">${icon('calendar-plus')} درخواست تمدید</button>${r.type === 'item' ? `<button class="secondary-btn" data-request-kind="return" data-id="${r.id}">اعلام بازگشت</button>` : ''}` : ''}${r.permissions?.pay && balance(r)>0 ? `<button class="secondary-btn" data-request-kind="payment" data-id="${r.id}">${icon('receipt')} ثبت پرداخت</button>` : ''}</div></section>
      ${r.cardSummary ? `<section class="info-block"><h2>کارت دریافت وجه</h2><p>${escape(r.cardSummary.bank_name || '')}</p><p dir="ltr">•••• ${escape(r.cardSummary.last4)}</p><button class="secondary-btn" data-card="${r.id}">نمایش شماره کامل</button></section>` : ''}
      ${r.type === 'expense' ? `<section class="info-block"><h2>افراد و سهم‌ها</h2>${!r.sharesConfigured ? `<p>اطلاعات قدیمی حفظ شده است؛ پیش از دعوت، افراد و مبلغ سهم‌ها را مشخص کنید.</p>${manage ? `<button class="secondary-btn" data-configure-shares="${r.id}">تعیین سهم‌ها</button>` : ''}` : ''}${r.memberShares.map((p) => `<div class="info-row"><span>${escape(p.display_name)}</span><b>${p.share_amount ? money(p.share_amount,r) : 'تعیین‌نشده'} · ${p.membership_status === 'accepted' ? 'متصل' : 'دعوت‌نشده'}</b></div>`).join('')}</section>` : ''}
      <section class="info-block span-2"><h2>درخواست‌ها</h2>${r.requests.length ? r.requests.map((q) => requestCard(q,r)).join('') : '<p>درخواستی ثبت نشده است.</p>'}</section>
      ${r.paymentEntries.length ? `<section class="info-block span-2"><h2>پرداخت‌ها و رسیدها</h2>${r.paymentEntries.map((p) => `<div class="workflow-request"><div><strong>${money(p.amount,r)}</strong><p>${escape(p.payerName)}</p></div><span>${p.status === 'confirmed' ? 'تأییدشده' : p.status === 'rejected' ? 'ردشده' : 'در انتظار'}</span>${p.receiptPath ? `<button class="text-btn" data-receipt-view="${p.id}">مشاهدهٔ رسید</button>` : ''}</div>`).join('')}</section>` : ''}
      <section class="info-block span-2"><h2>سابقهٔ مشترک</h2><ol class="timeline">${r.events.map((e) => `<li>${escape(e.text)}<time>${date(e.at)}</time></li>`).join('')}</ol></section></div>`;
  }

  function notificationsPage() {
    return `<div class="page-head"><h1>اعلان‌ها</h1><button class="text-btn" data-read-all>خواندن همه</button></div>${notificationsError ? `<p class="field-error" role="alert">${escape(notificationsError)} <button class="text-btn" data-sync>تلاش دوباره</button></p>` : ''}${state.notifications.map((n) => {
      const r = getRecord(n.recordId), q = r?.requests.find((q) => q.id === n.requestId);
      return `<article class="info-block workflow-notification ${n.read ? 'is-read' : ''}"><strong>${escape(n.title)}</strong><p>${escape(n.text)}</p>${q ? requestCard(q,r) : ''}<div class="actions">${r ? `<button class="text-btn" data-record="${r.id}" data-read="${n.id}">مشاهدهٔ بده‌بستان</button>` : ''}${!n.read ? `<button class="text-btn" data-read="${n.id}">خواندم</button>` : '<small>خوانده‌شده</small>'}</div></article>`;
    }).join('') || (!notificationsError ? '<p class="empty">اعلانی ندارید.</p>' : '')}`;
  }

  function settings() {
    return `<h1>تنظیمات</h1><section class="info-block"><div class="setting-row"><div><strong>${escape(user?.user_metadata?.display_name || user?.email || 'حساب کاربری')}</strong></div><button class="secondary-btn" data-account-action>مدیریت حساب</button></div><div class="setting-row"><label for="wf-reminders">یادآوری موعدها بر اساس ساعت تهران</label><input id="wf-reminders" class="toggle" type="checkbox" data-reminder-pref ${preferences.reminders_enabled ? 'checked' : ''}></div><div class="setting-row"><div><strong>اعلان این دستگاه</strong><p>با اجازهٔ شما؛ اعلان داخل برنامه همیشه باقی می‌ماند.</p></div><div class="actions"><button class="primary-btn" data-push-enable>فعال‌کردن اعلان</button><button class="secondary-btn" data-push-disable>غیرفعال‌کردن این دستگاه</button></div></div><p class="field-error" id="push-status" role="status"></p></section>`;
  }

  function content() {
    if (!user) return '<section class="info-block"><h1>بده‌بستان</h1><p>برای دیدن بده‌بستان‌ها یا پذیرفتن دعوت وارد حساب شوید.</p><button class="primary-btn" data-login>ورود / ساخت حساب</button></section>';
    if (active === 'detail') { const r = getRecord(detailId); return r ? detailPage(r) : '<p>در حال دریافت بده‌بستان…</p>'; }
    if (active === 'notifications') return notificationsPage();
    if (active === 'settings') return settings();
    if (active === 'share') return `<h1>دعوت</h1>${recordCards(state.records.filter((r) => r.permissions?.manage))}`;
    return home();
  }

  function renderSurface(refresh = false) {
    const x = scrollX, y = scrollY;
    const html = content();
    if (refresh && document.querySelector('#main')?.closest('[data-unified]')) {
      document.querySelector('#main').innerHTML = html;
    } else {
      app.innerHTML = `<div class="app-shell" data-unified><header class="topbar"><div class="topbar-inner"><div class="brand-row"><div class="brand">بده‌بستان<span></span></div><div class="top-actions"><button class="icon-btn" data-action="toggle-dark" aria-label="تغییر تم">${icon('sun')}</button><button class="icon-btn" data-go="notifications" aria-label="اعلان‌ها">${icon('bell')}<span data-unread></span></button></div></div><p class="workflow-connection" role="status" data-connection></p></div></header><nav class="nav"><div class="nav-inner">${[['home','خانه','house'],['records','بده‌بستان‌ها','handshake'],['notifications','اعلان‌ها','bell'],['settings','تنظیمات','gear-six']].map(([key,title,i]) => `<button data-go="${key}" class="${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(i)} ${title}</button>`).join('')}</div></nav><main class="main" id="main">${html}</main></div>`;
    }
    updateConnection();
    if (refresh) { scrollTo(x,y); requestAnimationFrame(() => scrollTo(x,y)); }
  }

  function updateConnection() {
    const node = document.querySelector('[data-connection]');
    const message = syncError || (connected ? 'به‌روز • اتصال زنده' : user ? 'همگام‌سازی دوره‌ای فعال است' : 'ورود به حساب');
    if (node && node.textContent !== message) node.textContent = message;
    const unread = document.querySelector('[data-unread]');
    if (unread) unread.textContent = state.unreadCount ? fa(state.unreadCount) : '';
  }

  function schedule() {
    clearTimeout(timer);
    if (!user || document.hidden) return;
    timer = setTimeout(async () => {
      await sync();
      if (!channel) connect();
    }, connected ? 60000 : backoff);
  }

  function changed() {
    clearTimeout(debounce);
    debounce = setTimeout(() => sync(), 150);
  }

  async function connect() {
    if (!user || channel || document.hidden) return;
    try {
      realtime ||= backend.realtimeClient();
      const session = await backend.session();
      if (!session || session.id !== user?.id) return;
      await realtime.realtime.setAuth(session.access_token);
      // INSERT/UPDATE only: DELETE payloads cannot be checked by RLS.
      const subscribed = realtime.channel('workflow-' + user.id);
      channel = subscribed;
      for (const table of ['records','record_participants','record_requests','repayments','record_events','notifications','notification_preferences']) {
        for (const event of ['INSERT','UPDATE']) channel.on('postgres_changes', { event, schema:'public', table }, changed);
      }
      channel.subscribe((status) => {
        if (channel !== subscribed) return;
        connected = status === 'SUBSCRIBED';
        if (connected) { backoff = 5000; sync(); }
        if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
          const old = channel; channel = null;
          if (old) realtime.removeChannel(old);
          schedule();
        }
        updateConnection();
      });
    } catch { connected = false; channel = null; schedule(); }
  }

  function sync() {
    if (inFlight) { queued = true; return inFlight; }
    const currentRevision = revision;
    const operation = (async () => {
      try {
        const session = await backend.session();
        if (currentRevision !== revision) return false;
        if (!session) { clearAccount(); return false; }
        if (user && user.id !== session.id) { clearAccount(); return false; }
        if (!user) {
          try { for (const [id, shared] of JSON.parse(sessionStorage.getItem('bedeh-invites-' + session.id) || '[]')) tokens.set(id,shared); } catch { /* Ignore invalid local invitation cache. */ }
        }
        user = session;
        window.BedehEnhancements.setCurrentUser(session);
        const [dashboard, notes, prefs] = await Promise.allSettled([backend.command('dashboard'), backend.command('notifications'), backend.command('preferences')]);
        if (currentRevision !== revision) return false;
        if (dashboard.status === 'rejected') throw dashboard.reason;
        const before = JSON.stringify({ records: state.records, notes: state.notifications, memberships, preferences, notificationsError });
        state.records = dashboard.value.records.map(window.BedehEnhancements.mapServerRecord);
        for (const r of state.records) {
          const cached = tokens.get(r.id);
          if (cached && r.shareLinks.some((l) => l.id === cached.id && !l.revoked_at && (!l.expires_at || Date.parse(l.expires_at)>Date.now()))) r.shareToken = cached.token;
        }
        memberships = dashboard.value.membershipRequests || [];
        if (notes.status === 'fulfilled') {
          state.notifications = notes.value.notifications.map((n) => ({ id:n.id,recordId:n.record_id,requestId:n.request_id,title:n.title,text:n.body,read:Boolean(n.read_at) }));
          state.unreadCount = notes.value.unreadCount;
          notificationsError = '';
        } else notificationsError = 'دریافت اعلان‌ها انجام نشد؛ اطلاعات قبلی حفظ شده است.';
        if (prefs.status === 'fulfilled') preferences = prefs.value.preferences;
        const after = JSON.stringify({ records: state.records, notes: state.notifications, memberships, preferences, notificationsError });
        syncError = prefs.status === 'rejected' ? 'دریافت تنظیمات یادآوری انجام نشد؛ دوباره تلاش می‌کنیم.' : '';
        if (before !== after || !lastData) { renderSurface(true); lastData = after; }
        backoff = connected ? 5000 : Math.min(backoff * 2, 120000);
        updateConnection();
        return true;
      } catch (error) {
        syncError = error.message || 'همگام‌سازی انجام نشد؛ دوباره تلاش می‌کنیم.';
        backoff = Math.min(backoff * 2, 120000);
        updateConnection();
        return false;
      } finally { schedule(); }
    })();
    inFlight = operation;
    operation.finally(() => {
      if (inFlight === operation) inFlight = null;
      if (queued) { queued = false; changed(); }
    });
    return operation;
  }

  function clearAccount() {
    if (user) sessionStorage.removeItem('bedeh-invites-' + user.id);
    revision += 1; user = null; queued = false; connected = false;
    window.BedehEnhancements.setCurrentUser(null);
    clearTimeout(timer); clearTimeout(debounce);
    if (realtime) realtime.removeAllChannels();
    channel = null; realtime = null; tokens.clear(); lastData = '';
    state.records = []; state.notifications = []; state.unreadCount = 0; memberships = [];
    preferences = {}; detailId = ''; active = 'home';
    localStorage.removeItem(STORE);
    if (sheet.open) sheet.close();
    renderSurface();
  }

  async function claim(token, participantId) {
    if (claimBusy) return;
    claimBusy = true;
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('لینک دعوت معتبر نیست.');
      invitation = token;
      user = await backend.session();
      if (!user) { renderSurface(); window.BedehEnhancements.showAccount('login','برای پذیرفتن دعوت وارد شوید یا حساب بسازید.'); return; }
      const result = await backend.api('claim-share-link', { token, participantId: participantId || null });
      if (result.status === 'choose-share') {
        showSheet('انتخاب سهم شما', `<p>نام خود را انتخاب کنید. اطلاعات خصوصی پس از تأیید سازنده نمایش داده می‌شود.</p><div class="workflow-share-options">${result.shares.map((s) => `<button class="secondary-btn" data-claim-share="${s.id}">${escape(s.name)}</button>`).join('') || '<p>سهم آزادی باقی نمانده است.</p>'}</div><p class="field-error" data-claim-error role="alert"></p>`);
        return;
      }
      invitation = null;
      history.replaceState(null,'',location.pathname);
      if (sheet.open) sheet.close();
      active = 'home'; detailId = '';
      await sync(); renderSurface(); connect();
      notice(result.status === 'pending' ? 'درخواست عضویت برای سازنده ارسال شد.' : 'بده‌بستان در صفحهٔ اصلی شماست.');
    } catch (error) {
      const inline = document.querySelector('[data-claim-error]');
      if (inline) inline.textContent = error.message;
      else { renderSurface(); showSheet('دعوت', `<p role="alert">${escape(error.message)}</p><button class="secondary-btn" data-retry-invite>تلاش دوباره</button><button class="text-btn" data-dismiss-invite>بازگشت به خانه</button>`); }
    } finally { claimBusy = false; }
  }

  async function start() {
    if (started) return;
    started = true;
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get('share') || new URLSearchParams(location.search).get('token');
    renderSurface();
    if (token) await claim(token);
    else {
      await sync(); renderSurface();
      const recordId = hash.get('record');
      if (recordId && getRecord(recordId)) openRecord(recordId);
    }
    connect();
  }

  function openRequest(r, kind) {
    const fields = kind === 'extension' ? '<label for="request-due">موعد پیشنهادی</label><input id="request-due" name="due" type="date" required>' : kind === 'payment' ? `<label for="request-amount">مبلغ (${escape(r.currency)})</label><input id="request-amount" name="amount" inputmode="numeric" required>${r.permissions.manage && r.type === 'expense' ? `<label for="request-person">سهم پرداخت‌کننده</label><select id="request-person" name="participantId" required>${r.memberShares.map((p) => `<option value="${p.id}">${escape(p.display_name)}</option>`).join('')}</select>` : ''}<label for="request-receipt">رسید (اختیاری)</label><input id="request-receipt" type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf"><small>تا ۵ مگابایت</small>` : '<p>اعلام بازگشت شما برای تأیید سازنده ارسال می‌شود.</p>';
    showSheet(label[kind], `<form class="account-form" data-workflow-form="request" data-id="${r.id}" data-kind="${kind}" data-key="${crypto.randomUUID()}">${fields}<label for="request-note">توضیح (اختیاری)</label><textarea id="request-note" name="note" maxlength="500"></textarea><p class="field-error" role="alert"></p><button class="primary-btn" type="submit">ارسال درخواست</button></form>`);
  }

  async function invite(r) {
    if (!r.permissions.manage) return;
    if (r.type === 'expense' && !r.sharesConfigured) return configureShares(r);
    if (!r.shareToken) {
      const shared = await backend.command('create-share-link', { recordId:r.id });
      rememberInvite(r.id,shared);
      await sync(); r = getRecord(r.id); r.shareToken = shared.token;
    }
    const url = `${location.origin}/#share=${r.shareToken}`;
    showSheet('لینک و QR دعوت', `<div class="share-box"><p>این دعوت به حساب متصل می‌شود. لغو لینک فقط عضویت جدید را می‌بندد.</p><img class="qr" alt="QR دعوت" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=svg&data=${encodeURIComponent(url)}"><label for="invitation-url">لینک دعوت</label><input id="invitation-url" readonly value="${escape(url)}"><div class="actions"><button class="primary-btn" data-copy-invite>کپی لینک</button><button class="secondary-btn" data-revoke-invite="${r.id}">لغو دعوت جدید</button></div><p class="field-error" data-invite-error role="alert"></p></div>`);
    sheet.querySelector('.qr').onerror = () => { sheet.querySelector('[data-invite-error]').textContent = 'QR دریافت نشد؛ می‌توانید لینک را کپی کنید.'; };
  }

  function configureShares(r) {
    showSheet('تعیین سهم‌های دنگ', `<form class="account-form" data-workflow-form="shares" data-id="${r.id}"><p>مبلغ کل: ${money(r.totalAmount,r)}</p><p>نام‌های قبلی: ${escape(r.memberShares.map((p) => p.display_name).join('، '))}</p><label for="configure-shares">هر خط: نام و مبلغ سهم با دونقطه</label><textarea id="configure-shares" name="shares" required placeholder="علی: ۴۰۰۰۰۰"></textarea><p class="field-error" role="alert"></p><button type="submit" class="primary-btn">ذخیرهٔ سهم‌ها</button></form>`);
  }

  async function push(enable) {
    const status = document.querySelector('#push-status');
    const deviceId = localStorage.getItem('bedeh-device-id') || crypto.randomUUID();
    localStorage.setItem('bedeh-device-id',deviceId);
    try {
      if (!enable) { await backend.api('push-device',{ action:'disable',deviceId }); status.textContent = 'اعلان این دستگاه غیرفعال شد.'; return; }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('اعلان Push در این مرورگر پشتیبانی نمی‌شود؛ اعلان داخل برنامه فعال است.');
      const config = await backend.api('push-device',{ action:'config' });
      if (!config.configured) throw new Error('ارسال Push هنوز در سرور تنظیم نشده است؛ اعلان داخل برنامه فعال است.');
      if (await Notification.requestPermission() !== 'granted') throw new Error('اجازهٔ اعلان داده نشد؛ اعلان داخل برنامه باقی می‌ماند.');
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')), (c) => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly:true,applicationServerKey:key });
      await backend.api('push-device',{ action:'subscribe',deviceId,subscription:subscription.toJSON() });
      status.textContent = 'اشتراک این دستگاه ثبت شد.';
    } catch (error) { status.textContent = error.message; }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const d = button.dataset;
    const handled = ['go','record','decision','requestKind','card','invite','configureShares','read','readAll','sync','login','claimShare','retryInvite','dismissInvite','copyInvite','revokeInvite','ownerAction','pushEnable','pushDisable','workflowFilter'].some((key) => key in d);
    if (!handled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (button.disabled) return;
    button.disabled = true;
    try {
      if ('go' in d) { active=d.go; detailId=''; renderSurface(); }
      if ('workflowFilter' in d) { window.filter=d.workflowFilter; renderSurface(); }
      if ('login' in d) window.BedehEnhancements.showAccount('login');
      if ('record' in d) openRecord(d.record);
      if ('read' in d) { await backend.command('mark-notification-read',{ notificationId:d.read }); await sync(); }
      if ('readAll' in d) { await backend.command('mark-all-notifications-read'); await sync(); }
      if ('sync' in d) await sync();
      if ('decision' in d) {
        const result = await backend.api('respond-request',{ requestId:d.request,decision:d.decision });
        notice(`درخواست ${statuses[result.status]} است.`); await sync();
      }
      if ('requestKind' in d) openRequest(getRecord(d.id),d.requestKind);
      if ('invite' in d) await invite(getRecord(d.invite));
      if ('configureShares' in d) configureShares(getRecord(d.configureShares));
      if ('claimShare' in d) await claim(invitation,d.claimShare);
      if ('retryInvite' in d) await claim(invitation);
      if ('dismissInvite' in d) { invitation=null; history.replaceState(null,'',location.pathname); sheet.close(); active='home'; await sync(); renderSurface(); connect(); }
      if ('copyInvite' in d) { await navigator.clipboard.writeText(document.querySelector('#invitation-url').value); notice('لینک کپی شد.'); }
      if ('revokeInvite' in d) { const r=getRecord(d.revokeInvite); await backend.command('revoke-share-link',{ linkId:r.shareLinkId }); tokens.delete(r.id); sheet.close(); await sync(); notice('دعوت جدید بسته شد؛ اعضای پذیرفته‌شده دسترسی دارند.'); }
      if ('card' in d) {
        const card=await backend.api('card-access',{ recordId:d.card });
        showSheet('شماره کارت',`<p dir="ltr" class="full-card-number">${escape(card.number.match(/.{1,4}/g).join(' '))}</p><button class="primary-btn" data-copy="${escape(card.number)}">کپی شماره کارت</button>`);
      }
      if ('ownerAction' in d) {
        showSheet(d.ownerAction==='mark-returned'?'ثبت بازگشت':'تغییر موعد',`<form class="account-form" data-workflow-form="owner" data-id="${d.id}" data-command="${d.ownerAction}">${d.ownerAction==='mark-returned'?'<p>با ثبت بازگشت، امانت بسته می‌شود.</p>':'<label for="owner-due">موعد جدید</label><input id="owner-due" type="date" name="due" required>'}<p class="field-error" role="alert"></p><button class="primary-btn" type="submit">ثبت</button></form>`);
      }
      if ('pushEnable' in d) await push(true);
      if ('pushDisable' in d) await push(false);
    } catch (error) { notice(error.message || 'عملیات انجام نشد؛ دوباره تلاش کنید.'); }
    finally { button.disabled=false; }
  },true);

  document.addEventListener('submit', async (event) => {
    const form=event.target;
    if (!form.matches('[data-workflow-form]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (form.dataset.busy || !form.reportValidity()) return;
    form.dataset.busy='true';
    const button=form.querySelector('[type="submit"]'), error=form.querySelector('.field-error');
    button.disabled=true; error.textContent='';
    try {
      const data=new FormData(form), recordId=form.dataset.id;
      if (form.dataset.workflowForm==='shares') await backend.command('configure-shares',{ recordId,shares:parseShares(data.get('shares')) });
      else if (form.dataset.workflowForm==='owner') await backend.command(form.dataset.command,{ recordId,dueAt:data.get('due') });
      else {
        const payload={ note:data.get('note'),dueAt:data.get('due'),participantId:data.get('participantId') };
        if (form.dataset.kind==='payment') {
          payload.amount=Number(core.asciiDigits(data.get('amount')).replace(/[٬,\s]/g,''));
          if (!Number.isSafeInteger(payload.amount) || payload.amount<=0) throw new Error('مبلغ معتبر وارد کنید.');
          const file=data.get('receipt');
          if (file?.size) {
            const fileError=core.receiptFileError(file); if (fileError) throw new Error(fileError);
            // Keep the upload across a request retry; do not upload another copy.
            if (!form.uploadedReceipt || form.uploadedFile !== file) { form.uploadedReceipt=await backend.uploadReceipt(recordId,file); form.uploadedFile=file; }
            Object.assign(payload,{ receiptPath:form.uploadedReceipt.path,receiptName:form.uploadedReceipt.name,receiptMime:form.uploadedReceipt.mime });
          }
        }
        await backend.api('create-request',{ recordId,kind:form.dataset.kind,payload,idempotencyKey:form.dataset.key });
      }
      sheet.close(); await sync(); notice('در سرور ثبت شد.');
    } catch (failure) { error.textContent=failure.message; }
    finally { delete form.dataset.busy; button.disabled=false; }
  },true);

  document.addEventListener('change', async (event) => {
    if (!event.target.matches('[data-reminder-pref]')) return;
    event.stopImmediatePropagation(); const toggle=event.target; toggle.disabled=true;
    try { const result=await backend.command('save-preferences',{ remindersEnabled:toggle.checked }); preferences=result.preferences; }
    catch (error) { toggle.checked=!toggle.checked; notice(error.message); }
    finally { toggle.disabled=false; }
  },true);

  window.addEventListener('bedeh-signed-out',clearAccount);
  window.addEventListener('online',()=>{ backoff=5000; sync(); connect(); });
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) { backoff=5000; sync(); connect(); } else clearTimeout(timer); });
  window.addEventListener('hashchange',()=>{ const params=new URLSearchParams(location.hash.slice(1)); if (params.has('share')) claim(params.get('share')); else if(params.has('record')) sync().then(()=>openRecord(params.get('record'))); });
  navigator.serviceWorker?.addEventListener('message',(event)=>{ if(event.data?.type==='open-record') sync().then(()=>openRecord(event.data.recordId)); });
  const originalRender=render;
  render=function(){ if (window.BedehUnified) renderSurface(); else originalRender(); };
  openRecord=function(recordId){ if(!getRecord(recordId)) { notice('این بده‌بستان هنوز در دسترس حساب شما نیست.'); return; } detailId=recordId; active='detail'; renderSurface(); };
  window.BedehUnified={ start,sync,claim,parseShares,rememberInvite,afterLogin:async()=>{ await sync(); if(invitation) await claim(invitation); connect(); } };
  if (document.readyState!=='loading') start();
}());
