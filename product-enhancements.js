/* Cohesive production enhancements layered over the legacy renderer while all
   record mutations continue through authenticated Supabase Edge Functions. */
(function () {
  const core = window.BedehProductCore;
  const backend = window.BedehBackend;
  if (!core || !backend) return;

  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const eventLabels = {
    record_created: 'رکورد ثبت شد.',
    share_link_created: 'لینک اشتراک ساخته شد.',
    recipient_confirmed: 'گیرنده دریافت را تأیید کرد.',
    extension_requested: 'درخواست تمدید ثبت شد.',
    repayment_recorded: 'پرداخت ثبت شد.',
    repayment_confirmed: 'پرداخت تأیید شد.',
    item_returned: 'بازگشت وسیله تأیید شد.',
    link_revoked: 'لینک غیرفعال شد.',
    reminder_sent: 'یادآوری ارسال شد.',
    due_date_changed: 'موعد تغییر کرد.',
  };
  let currentUser = null;
  let activeReceiptRecordId = '';
  let syncing = false;
  let tickerPaused = false;
  const onboardedKey = 'bedeh-bestan.auth.onboarded';
  const legacyPendingEmailKey = 'bedeh-bestan.auth.pending-email';
  const hasOnboarded = () => localStorage.getItem(onboardedKey) === 'true';

  const icon = (name, filled = false) => `<i class="ph${filled ? '-fill' : ''} ph-${name}" aria-hidden="true"></i>`;
  const htmlEscape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const notify = (message) => typeof notice === 'function' ? notice(message) : window.alert(message);
  const persianNumber = (value) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
  const recordById = (recordId) => typeof state !== 'undefined' ? state.records.find((record) => record.id === recordId || record.serverId === recordId) : null;

  function chosenTheme() {
    const saved = localStorage.getItem('bedeh-bestan.theme');
    if (saved === 'light' || saved === 'dark') return saved;
    if (typeof state !== 'undefined' && state.settings?.dark === false) return 'light';
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function setTheme(theme, persist = true) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.body.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#F4F6F8' : '#1E1E1E');
    if (persist) localStorage.setItem('bedeh-bestan.theme', next);
    if (typeof state !== 'undefined' && state.settings) {
      state.settings.dark = next === 'dark';
      if (typeof save === 'function') save();
    }
    decorateTopbar();
  }

  function decorateTopbar() {
    const themeButton = document.querySelector('[data-action="toggle-dark"]');
    if (themeButton) {
      const isDark = document.documentElement.dataset.theme !== 'light';
      const nextIcon = isDark ? 'sun' : 'moon';
      if (themeButton.dataset.productIcon !== nextIcon) themeButton.innerHTML = icon(nextIcon);
      themeButton.dataset.productIcon = nextIcon;
      themeButton.setAttribute('aria-label', isDark ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تیره');
      themeButton.title = themeButton.getAttribute('aria-label');
      themeButton.classList.add('topbar-icon-only');
    }
    const notifications = document.querySelector('[data-action="open-notifications"]');
    if (notifications) {
      const unread = typeof state !== 'undefined' ? state.notifications.filter((item) => !item.read).length : 0;
      const unreadKey = String(unread > 0);
      if (notifications.dataset.productUnread !== unreadKey) notifications.innerHTML = `${icon('bell')}${unread ? '<span class="notification-dot" aria-hidden="true"></span>' : ''}`;
      notifications.dataset.productUnread = unreadKey;
      notifications.setAttribute('aria-label', unread ? `اعلان‌ها، ${persianNumber(unread)} خوانده‌نشده` : 'اعلان‌ها');
      notifications.title = 'اعلان‌ها';
      notifications.classList.add('topbar-icon-only');
    }
    document.querySelector('.top-meta')?.remove();
    document.querySelectorAll('.nav [data-nav]').forEach((item) => {
      if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  let dialogSignature = '';

  function enhanceDialog(root = document) {
    const dialog = root.matches?.('dialog') ? root : root.querySelector?.('dialog#sheet');
    if (!dialog || !dialog.open) return;
    const signature = dialog.innerHTML;
    if (signature === dialogSignature) return;
    const closeButton = dialog.querySelector('[data-close], .close-btn');
    if (closeButton) {
      closeButton.innerHTML = icon('x');
      closeButton.setAttribute('aria-label', 'بستن');
      closeButton.title = 'بستن';
    }
    dialogSignature = dialog.innerHTML;
    requestAnimationFrame(() => {
      const firstField = dialog.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea');
      firstField?.focus({ preventScroll: true });
    });
  }

  function addTicker() {
    const main = document.querySelector('main#main');
    if (!main || main.querySelector('.tip-ticker')) return;
    const ticker = document.createElement('aside');
    ticker.className = 'tip-ticker';
    ticker.dataset.paused = String(tickerPaused);
    ticker.setAttribute('aria-label', 'نکته‌های بده‌بستان');
    const group = `<div class="tip-ticker__group">${core.tips.map((tip) => `<span class="tip-ticker__item">${htmlEscape(tip)}</span>`).join('')}</div>`;
    ticker.innerHTML = `<span class="tip-ticker__label">${icon('sparkle')} نکته</span><div class="tip-ticker__viewport"><div class="tip-ticker__track" aria-hidden="true">${group}${group}</div><span class="sr-only">${htmlEscape(core.tips.join(' '))}</span></div><button type="button" class="icon-btn tip-ticker__toggle" data-ticker-toggle aria-label="${tickerPaused ? 'پخش نکته‌ها' : 'توقف نکته‌ها'}" aria-pressed="${tickerPaused}">${icon(tickerPaused ? 'play' : 'pause')}</button>`;
    main.prepend(ticker);
  }

  function addCompletedTab() {
    const tabs = document.querySelector('main#main .tabs');
    if (!tabs || tabs.querySelector('[data-completed-filter]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab completed-tab${window.__bedehCompletedFilter ? ' active' : ''}`;
    button.dataset.completedFilter = 'true';
    button.innerHTML = `${icon('check-circle')} انجام‌شده‌ها`;
    tabs.append(button);
  }

  function renderCompletedRecords() {
    if (typeof state === 'undefined' || typeof recordList !== 'function') return;
    window.__bedehCompletedFilter = true;
    window.filter = '';
    document.querySelectorAll('main#main .tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.hasAttribute('data-completed-filter')));
    const section = document.querySelector('main#main .tabs + .section');
    if (!section) return;
    const completed = state.records.filter((record) => core.isCompleted(record.status)).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    section.innerHTML = recordList(completed);
    if (typeof bind === 'function') bind(section);
  }

  function addJalaliPicker(input) {
    if (input.dataset.jalaliReady) return;
    input.dataset.jalaliReady = 'true';
    input.classList.add('gregorian-date-value');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    const today = new Date();
    const current = input.value ? input.value.split('-').map(Number) : [today.getFullYear(), today.getMonth() + 1, today.getDate()];
    const selected = core.gregorianToJalali(current[0], current[1], current[2]);
    const nowJalali = core.gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
    const picker = document.createElement('div');
    picker.className = 'jalali-picker';
    picker.innerHTML = `<select class="jalali-day" aria-label="روز"></select><select class="jalali-month" aria-label="ماه">${months.map((month, index) => `<option value="${index + 1}"${selected.month === index + 1 ? ' selected' : ''}>${month}</option>`).join('')}</select><select class="jalali-year" aria-label="سال">${Array.from({ length: 11 }, (_, index) => nowJalali.year + index).map((year) => `<option value="${year}"${selected.year === year ? ' selected' : ''}>${core.formatPersianYear(year)}</option>`).join('')}</select>`;
    input.after(picker);
    const day = picker.querySelector('.jalali-day');
    const month = picker.querySelector('.jalali-month');
    const year = picker.querySelector('.jalali-year');
    const rebuildDays = (wanted = Number(day.value) || selected.day) => {
      const max = core.jalaliMonthLength(Number(year.value), Number(month.value));
      day.innerHTML = Array.from({ length: max }, (_, index) => `<option value="${index + 1}">${persianNumber(index + 1)}</option>`).join('');
      day.value = String(Math.min(wanted, max));
    };
    const update = () => {
      rebuildDays(Number(day.value));
      const gregorian = core.jalaliToGregorian(Number(year.value), Number(month.value), Number(day.value));
      const value = `${gregorian.year}-${String(gregorian.month).padStart(2, '0')}-${String(gregorian.day).padStart(2, '0')}`;
      day.setCustomValidity(value < new Date().toISOString().slice(0, 10) ? 'تاریخ سررسید نمی‌تواند گذشته باشد.' : '');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    rebuildDays(selected.day);
    day.value = String(selected.day);
    picker.addEventListener('change', update);
    update();
  }

  function enhanceJalaliDates(root = document) {
    root.querySelectorAll('input[type="date"][name="due"]').forEach(addJalaliPicker);
  }

  function accountLabel() {
    return currentUser?.user_metadata?.display_name || currentUser?.email || 'حساب کاربری';
  }

  function addAccountSetting() {
    const heading = [...document.querySelectorAll('main#main h1')].find((node) => node.textContent.trim() === 'تنظیمات');
    const panel = heading?.closest('main')?.querySelector('.info-block');
    if (!panel || panel.querySelector('[data-account-setting]')) return;
    const row = document.createElement('div');
    row.className = 'setting-row account-setting';
    row.dataset.accountSetting = 'true';
    row.innerHTML = `<div class="account-setting__identity">${icon('user-circle')}<div><strong>${htmlEscape(accountLabel())}</strong>${currentUser?.email && currentUser.email !== accountLabel() ? `<small dir="ltr">${htmlEscape(currentUser.email)}</small>` : ''}</div></div><div class="account-setting__actions"><button type="button" class="secondary-btn" data-account-action>${currentUser ? 'مدیریت حساب' : 'ورود'}</button></div><p class="field-error account-setting__error" role="alert"></p>`;
    panel.prepend(row);
  }

  function showAccount(mode = currentUser ? 'manage' : hasOnboarded() ? 'login' : 'register', message = '') {
    if (mode === 'manage' && currentUser) {
      showSheet('حساب کاربری', `<div class="account-form"><strong>${htmlEscape(accountLabel())}</strong><span dir="ltr">${htmlEscape(currentUser.email || '')}</span><button class="secondary-btn" type="button" data-sign-out>${icon('sign-out')} خروج از حساب</button></div>`);
      return;
    }
    const registering = mode === 'register';
    const form = `<div class="auth-tabs" role="group" aria-label="حساب کاربری"><button type="button" class="tab${!registering ? ' active' : ''}" data-auth-mode="login" aria-pressed="${!registering}">ورود</button><button type="button" class="tab${registering ? ' active' : ''}" data-auth-mode="register" aria-pressed="${registering}">ساخت حساب</button></div><form id="account-form" class="account-form" data-mode="${registering ? 'register' : 'login'}" novalidate>${registering ? '<div class="field"><label for="account-name">نام کاربری</label><input id="account-name" name="displayName" autocomplete="nickname" required maxlength="80"></div>' : ''}<div class="field"><label for="account-email">ایمیل</label><input id="account-email" name="email" type="email" autocomplete="email" dir="ltr" required></div><div class="field"><label for="account-password">رمز عبور</label><div class="password-control"><input id="account-password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="8" required aria-describedby="account-error"><button type="button" class="icon-btn password-control__toggle" data-password-toggle aria-label="نمایش رمز عبور" aria-pressed="false">${icon('eye')}</button></div></div><p class="field-error" id="account-error" role="alert">${htmlEscape(message)}</p><button class="primary-btn account-submit" type="submit">${registering ? `${icon('user-plus')} ساخت حساب` : `${icon('sign-in')} ورود`}</button></form>`;
    if (typeof showSheet === 'function') showSheet('حساب کاربری', form);
    enhanceDialog(document);
  }

  async function submitAccount(form) {
    if (form.dataset.busy === 'true') return;
    const submit = form.querySelector('.account-submit');
    const error = form.querySelector('#account-error');
    const data = new FormData(form);
    const mode = form.dataset.mode;
    const password = String(data.get('password') || '');
    error.textContent = '';
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      if (invalid) {
        invalid.setAttribute('aria-invalid', 'true');
        error.textContent = invalid.name === 'displayName' ? 'نام کاربری را وارد کنید.' : invalid.name === 'email' ? 'ایمیل معتبر وارد کنید.' : 'رمز عبور را کامل وارد کنید.';
        invalid.focus({ preventScroll: true });
      }
      return;
    }
    if (mode === 'register') {
      const passwordMessage = core.passwordError(password);
      if (passwordMessage) {
        error.textContent = passwordMessage;
        return;
      }
    }
    form.dataset.busy = 'true';
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'در حال اتصال…';
    try {
      const result = mode === 'register'
        ? await backend.signUp({ displayName: data.get('displayName'), email: data.get('email'), password })
        : await backend.signIn({ email: data.get('email'), password });
      const status = core.signupState(result);
      if (status !== 'authenticated') throw new Error(mode === 'register' ? 'ساخت حساب کامل نشد؛ دوباره تلاش کنید.' : 'ورود انجام نشد؛ دوباره تلاش کنید.');
      localStorage.setItem(onboardedKey, 'true');
      currentUser = result.user;
      sessionStorage.removeItem(legacyPendingEmailKey);
      sheet.close();
      if (typeof render === 'function') render();
      notify(mode === 'register' ? 'حساب ساخته شد و وارد شدید.' : 'وارد حساب شدید.');
      await syncFromBackend();
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      submit.disabled = false;
      delete form.dataset.busy;
      submit.removeAttribute('aria-busy');
      submit.innerHTML = mode === 'register' ? `${icon('user-plus')} ساخت حساب` : `${icon('sign-in')} ورود`;
    }
  }

  async function routeAccountEntry() {
    // Recipients must not be forced to create a full account.
    if (location.hash.startsWith('#share=') || new URLSearchParams(location.search).has('token')) return;
    try {
      currentUser = await backend.session();
    } catch (error) {
      if (error.code !== 'confirmation_link_invalid') throw error;
      sessionStorage.removeItem(legacyPendingEmailKey);
      showAccount('login', 'لینک قدیمی دیگر لازم نیست؛ با ایمیل و رمز عبور وارد شوید.');
      return;
    }
    if (currentUser) {
      localStorage.setItem(onboardedKey, 'true');
      sessionStorage.removeItem(legacyPendingEmailKey);
      await syncFromBackend();
    } else if (!hasOnboarded()) {
      showAccount('register');
    } else {
      sessionStorage.removeItem(legacyPendingEmailKey);
      if (typeof render === 'function') render();
    }
  }

  function mapServerRecord(record) {
    const entries = (record.repayments || []).map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      payerName: payment.payer_name,
      status: payment.status,
      at: payment.recorded_at,
      receiptPath: payment.receipt_path,
      receiptName: payment.receipt_name,
      receiptMime: payment.receipt_mime,
    }));
    const confirmed = entries.filter((payment) => payment.status === 'confirmed');
    const participants = record.record_participants || [];
    return {
      id: record.id,
      serverId: record.id,
      type: record.kind,
      title: record.title,
      item: record.kind === 'item' ? record.title : '',
      person: participants[0]?.display_name || '',
      participants: participants.map((participant) => participant.display_name),
      amount: Number(record.amount || 0),
      currency: record.currency === 'IRT' ? 'تومان' : 'ریال',
      due: record.due_at ? record.due_at.slice(0, 10) : '',
      note: record.notes || '',
      status: record.status,
      repayments: confirmed,
      paymentEntries: entries,
      events: (record.record_events || []).map((entry, index) => ({ id: `${record.id}-${index}`, text: eventLabels[entry.event_type] || entry.event_type, at: entry.created_at })),
      shareLinks: record.share_links || [],
      shareLinkId: record.share_links?.find((link) => !link.revoked_at)?.id || '',
      revoked: Boolean(record.share_links?.length && record.share_links.every((link) => link.revoked_at)),
      createdAt: record.created_at,
      reminder: true,
    };
  }

  async function syncFromBackend() {
    if (syncing || !backend.configured) return;
    syncing = true;
    try {
      currentUser = await backend.session();
      if (!currentUser || typeof state === 'undefined') return;
      const dashboard = await backend.command('dashboard');
      state.records = (dashboard.records || []).map(mapServerRecord);
      const notifications = await backend.command('notifications').catch(() => ({ notifications: [] }));
      state.notifications = (notifications.notifications || []).map((item) => ({ id: item.id, recordId: item.record_id, title: item.title, text: item.body, read: Boolean(item.read_at) }));
      if (typeof save === 'function') save();
      if (typeof render === 'function') render();
    } catch (failure) {
      notify(failure.message || 'ارتباط با سرور برقرار نشد.');
    } finally {
      syncing = false;
      enhancePage();
    }
  }

  async function submitServerRecord(form) {
    const user = await backend.session();
    if (!user) {
      showAccount('login');
      notify('برای ثبت بده‌بستان وارد حساب شوید.');
      return;
    }
    const data = new FormData(form);
    const kind = data.get('type');
    const amount = Number(core.asciiDigits(data.get('amount') || '').replace(/\D/g, ''));
    const participantText = String(data.get('participants') || '').split(/[،,]/).map((part) => part.trim()).filter(Boolean).join('، ');
    const payload = {
      kind,
      title: String(data.get('title') || data.get('item') || '').trim(),
      recipientName: kind === 'expense' ? participantText : String(data.get('person') || '').trim(),
      amount: kind === 'item' ? null : amount,
      currency: data.get('currency') === 'تومان' ? 'IRT' : 'IRR',
      dueAt: data.get('due'),
      notes: data.get('note') || null,
      cardNumber: String(data.get('cardNumber') || '').replace(/\D/g, '') || null,
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    const oldLabel = submit.innerHTML;
    submit.innerHTML = `${icon('spinner-gap')} در حال ثبت…`;
    try {
      const created = await backend.command('create-record', payload);
      const shared = await backend.command('create-share-link', { recordId: created.id, expiresAt: null });
      await syncFromBackend();
      const record = recordById(created.id);
      if (record) {
        record.shareToken = shared.token;
        record.shareLinkId = shared.id || record.shareLinkId;
        if (typeof save === 'function') save();
      }
      sheet.close();
      notify('رکورد ثبت شد و لینک خصوصی ساخته شد.');
      if (record && typeof openRecord === 'function') openRecord(record.id);
    } catch (failure) {
      const message = form.querySelector('#wizard-error') || form.querySelector('.field-error');
      if (message) message.textContent = failure.message;
      else notify(failure.message);
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.innerHTML = oldLabel;
    }
  }

  function enhanceRepaymentForm(form) {
    if (form.querySelector('[name="payerName"]')) return;
    const actions = form.querySelector('.form-actions');
    actions?.insertAdjacentHTML('beforebegin', `<div class="field"><label for="repayment-payer">پرداخت‌کننده</label><input id="repayment-payer" name="payerName" required maxlength="80" autocomplete="name"></div><div class="field"><label for="receipt-file">رسید واریز <span class="optional-label">اختیاری</span></label><input id="receipt-file" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><small>JPG، PNG، WebP یا PDF تا ۵ مگابایت</small><span class="field-error receipt-error" role="alert"></span></div>`);
  }

  async function submitRepayment(form) {
    const record = recordById(activeReceiptRecordId);
    if (!record?.serverId) return notify('این رکورد هنوز روی سرور ثبت نشده است.');
    const data = new FormData(form);
    const amount = Number(core.asciiDigits(data.get('amount') || '').replace(/\D/g, ''));
    const payerName = String(data.get('payerName') || '').trim();
    const file = data.get('receipt');
    const fileError = file?.size ? core.receiptFileError(file) : '';
    const inlineError = form.querySelector('.receipt-error');
    if (!amount || amount > (typeof remaining === 'function' ? remaining(record) : record.amount)) return notify('مبلغ باید بیشتر از صفر و حداکثر برابر مانده باشد.');
    if (!payerName) return notify('نام پرداخت‌کننده را وارد کنید.');
    if (fileError) {
      inlineError.textContent = fileError;
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'در حال ثبت…';
    try {
      const receipt = file?.size ? await backend.uploadReceipt(record.serverId, file) : null;
      await backend.command('record-repayment', {
        recordId: record.serverId,
        amount,
        payerName,
        receiptPath: receipt?.path || null,
        receiptName: receipt?.name || null,
        receiptMime: receipt?.mime || null,
      });
      sheet.close();
      notify('پرداخت ثبت شد و منتظر تأیید است.');
      await syncFromBackend();
      if (typeof openRecord === 'function') openRecord(record.serverId);
    } catch (failure) {
      inlineError.textContent = failure.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'ثبت بازپرداخت';
    }
  }

  function addPaymentEntries() {
    if (typeof state === 'undefined') return;
    const detailGrid = document.querySelector('main#main .detail-grid');
    if (!detailGrid || detailGrid.querySelector('[data-payment-entries]')) return;
    const title = document.querySelector('main#main .detail-title')?.textContent;
    const record = state.records.find((item) => item.title === title && item.paymentEntries?.length);
    if (!record) return;
    const section = document.createElement('section');
    section.className = 'info-block span-2 payment-entries';
    section.dataset.paymentEntries = 'true';
    section.innerHTML = `<h2>پرداخت‌ها و رسیدها</h2>${record.paymentEntries.map((payment) => `<div class="payment-entry"><div><strong>${persianNumber(payment.amount)} ${htmlEscape(record.currency)}</strong><small>${htmlEscape(payment.payerName || '')}</small></div><span class="chip ${payment.status === 'confirmed' ? 'done' : 'open'}">${payment.status === 'confirmed' ? 'تأیید شده' : 'در انتظار تأیید'}</span><div class="payment-entry__actions">${payment.receiptPath ? `<button class="ghost-btn" type="button" data-receipt-view="${payment.id}">${icon('receipt')} مشاهده رسید</button>` : ''}${payment.status === 'recorded' ? `<button class="secondary-btn" type="button" data-confirm-payment="${payment.id}">${icon('check-circle')} تأیید پرداخت</button>` : ''}</div></div>`).join('')}`;
    detailGrid.append(section);
  }

  function cleanInvalidLegacyLabels(root = document) {
    root.querySelectorAll?.('.record-card h3,.detail-title').forEach((heading) => {
      if (!heading.textContent.trim() || heading.textContent.trim().toLowerCase() === 'null') heading.textContent = 'بدون عنوان';
    });
  }

  async function openReceipt(repaymentId) {
    try {
      const result = await backend.command('create-receipt-download', { repaymentId });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      notify(failure.message);
    }
  }

  async function confirmPayment(repaymentId) {
    try {
      await backend.command('confirm-repayment', { repaymentId });
      notify('پرداخت تأیید شد.');
      await syncFromBackend();
    } catch (failure) {
      notify(failure.message);
    }
  }

  function enhancePage(root = document) {
    decorateTopbar();
    addTicker();
    addCompletedTab();
    addAccountSetting();
    enhanceJalaliDates(root);
    const repayment = root.querySelector?.('#repayment-form') || document.querySelector('#repayment-form');
    if (repayment) enhanceRepaymentForm(repayment);
    addPaymentEntries();
    cleanInvalidLegacyLabels(root);
    enhanceDialog(root);
  }

  document.addEventListener('click', async (event) => {
    const themeButton = event.target.closest('[data-action="toggle-dark"]');
    if (themeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      return;
    }
    if (event.target.closest('[data-filter]')) window.__bedehCompletedFilter = false;
    if (event.target.closest('[data-completed-filter]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderCompletedRecords();
      return;
    }
    if (event.target.closest('[data-account-action]')) {
      event.preventDefault();
      showAccount();
      return;
    }
    const tickerToggle = event.target.closest('[data-ticker-toggle]');
    if (tickerToggle) {
      event.preventDefault();
      const ticker = tickerToggle.closest('.tip-ticker');
      const paused = ticker.dataset.paused !== 'true';
      tickerPaused = paused;
      ticker.dataset.paused = String(paused);
      tickerToggle.setAttribute('aria-pressed', String(paused));
      tickerToggle.setAttribute('aria-label', paused ? 'پخش نکته‌ها' : 'توقف نکته‌ها');
      tickerToggle.innerHTML = icon(paused ? 'play' : 'pause');
      return;
    }
    const passwordToggle = event.target.closest('[data-password-toggle]');
    if (passwordToggle) {
      event.preventDefault();
      const input = passwordToggle.closest('.password-control')?.querySelector('input');
      if (!input) return;
      const revealed = input.type === 'password';
      input.type = revealed ? 'text' : 'password';
      passwordToggle.innerHTML = icon(revealed ? 'eye-slash' : 'eye');
      passwordToggle.setAttribute('aria-label', revealed ? 'پنهان‌کردن رمز عبور' : 'نمایش رمز عبور');
      passwordToggle.setAttribute('aria-pressed', String(revealed));
      input.focus({ preventScroll: true });
      return;
    }
    const authMode = event.target.closest('[data-auth-mode]');
    if (authMode) {
      event.preventDefault();
      showAccount(authMode.dataset.authMode);
      return;
    }
    if (event.target.closest('[data-sign-out]')) {
      event.preventDefault();
      await backend.signOut();
      currentUser = null;
      sheet.close();
      notify('از حساب خارج شدید.');
      if (typeof render === 'function') render();
      return;
    }
    const repaymentButton = event.target.closest('[data-action="repayment"]');
    if (repaymentButton) activeReceiptRecordId = repaymentButton.dataset.id;
    const shareButton = event.target.closest('[data-share]');
    if (shareButton) {
      const record = recordById(shareButton.dataset.share);
      if (record?.serverId && !record.shareToken) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          const shared = await backend.command('create-share-link', { recordId: record.serverId, expiresAt: null });
          await syncFromBackend();
          const fresh = recordById(record.serverId);
          fresh.shareToken = shared.token;
          if (typeof save === 'function') save();
          if (typeof showShare === 'function') showShare(fresh);
        } catch (failure) {
          notify(failure.message);
        }
        return;
      }
    }
    const shareAction = event.target.closest('[data-action="revoke"],[data-action="replace-link"]');
    if (shareAction) {
      const record = recordById(shareAction.dataset.id);
      if (record?.serverId && record.shareLinkId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          if (shareAction.dataset.action === 'revoke') {
            if (!confirm('این لینک فوراً از دسترس گیرنده خارج می‌شود و بازگشت‌پذیر نیست. ادامه می‌دهید؟')) return;
            await backend.command('revoke-share-link', { linkId: record.shareLinkId });
            sheet.close();
            notify('لینک غیرفعال شد.');
            await syncFromBackend();
          } else {
            await backend.command('revoke-share-link', { linkId: record.shareLinkId });
            const shared = await backend.command('create-share-link', { recordId: record.serverId, expiresAt: null });
            await syncFromBackend();
            const fresh = recordById(record.serverId);
            fresh.shareToken = shared.token;
            if (typeof save === 'function') save();
            sheet.close();
            if (typeof showShare === 'function') showShare(fresh);
          }
        } catch (failure) {
          notify(failure.message);
        }
        return;
      }
    }
    const receiptButton = event.target.closest('[data-receipt-view]');
    if (receiptButton) {
      event.preventDefault();
      await openReceipt(receiptButton.dataset.receiptView);
      return;
    }
    const confirmButton = event.target.closest('[data-confirm-payment]');
    if (confirmButton) {
      event.preventDefault();
      await confirmPayment(confirmButton.dataset.confirmPayment);
    }
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-setting="dark"]')) setTimeout(() => setTheme(event.target.checked ? 'dark' : 'light'), 0);
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.closest?.('#account-form')) return;
    event.target.removeAttribute('aria-invalid');
    const error = document.querySelector('#account-error');
    if (error) error.textContent = '';
  }, true);

  document.addEventListener('submit', (event) => {
    if (event.target.matches('#account-form')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitAccount(event.target);
    } else if (event.target.matches('#record-form') && backend.configured) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return submitServerRecord(event.target).catch((failure) => {
        const error = event.target.querySelector('#wizard-error') || event.target.querySelector('.field-error');
        if (error) error.textContent = failure.message;
        else notify(failure.message);
      });
    } else if (event.target.matches('#repayment-form') && backend.configured) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitRepayment(event.target);
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) enhancePage(node);
  });

  function boot() {
    setTheme(chosenTheme(), false);
    enhancePage();
    observer.observe(document.body, { childList: true, subtree: true });
    routeAccountEntry().catch((failure) => notify(failure.message));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.BedehEnhancements = { syncFromBackend, showAccount, setTheme, routeAccountEntry };
}());
