(() => {
  const tokenFromHash = () => {
    const hash = new URLSearchParams(location.hash.slice(1));
    return hash.get('share') || new URLSearchParams(location.search).get('token');
  };

  const text = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const money = (value) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
  const kind = (value) => ({ item: 'امانت', money: 'قرض', expense: 'هزینهٔ مشترک' }[value] || 'بده‌بستان');
  const date = (value) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value)) : '—';

  const styles = `
    .shared-flow{min-height:100dvh;background:var(--bg);color:var(--text);display:grid;place-items:start center;padding:clamp(16px,5vw,48px);direction:rtl}
    .shared-flow__card{width:min(100%,560px);background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:clamp(20px,4vw,32px)}
    .shared-flow h1{font-size:1.35rem;line-height:1.6;margin:0 0 16px;overflow-wrap:anywhere}
    .shared-flow__rows{display:grid;border-block:1px solid var(--border);margin:24px 0}
    .shared-flow__row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
    .shared-flow__row:last-child{border:0}.shared-flow__row strong{min-width:0;text-align:end;font-variant-numeric:tabular-nums}
    .shared-flow__label,.shared-flow__notice{color:var(--muted)}
    .shared-flow__status{display:inline-flex;align-items:center;gap:8px;font-size:.875rem;color:var(--text)}
    .shared-flow__status i{color:var(--primary)}
    .shared-flow__actions{display:grid;gap:8px}
    .shared-flow button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;border-radius:8px;border:1px solid var(--border-strong);padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;transition:background .18s,color .18s}
    .shared-flow button:hover{filter:brightness(1.08)}.shared-flow button:active{filter:brightness(.94)}
    .shared-flow button:focus-visible,.shared-flow input:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
    .shared-flow button[disabled]{opacity:.58;cursor:wait}
    .shared-flow__primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary)!important}
    .shared-flow__secondary{background:var(--raised);color:var(--text)}
    .shared-flow__notice{margin:16px 0 0;font-size:.875rem;overflow-wrap:anywhere}
    .shared-flow__notice:empty{display:none}.shared-flow__notice[data-state=success]{color:var(--success)}.shared-flow__notice[data-state=error]{color:var(--danger)}
    .shared-flow__form{display:grid;gap:8px;margin-top:16px}.shared-flow [hidden]{display:none!important}
    .shared-flow input{width:100%;min-width:0;min-height:48px;box-sizing:border-box;border:1px solid var(--border-strong);border-radius:8px;background:var(--raised);color:var(--text);padding:0 12px;font:inherit}
  `;

  let token;
  let root;
  let record;
  let loading;
  let revision = 0;

  const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
  const actionButton = (action, label, primary = false) => `<button type="button" data-workflow-action="${action}" class="${primary ? 'shared-flow__primary' : 'shared-flow__secondary'}">${icon(({ 'confirm-receipt': 'check-circle', 'request-return': 'handshake', 'show-extension': 'calendar', 'show-repayment': 'banknote', 'copy-card': 'copy' })[action])}${label}</button>`;

  const render = () => {
    const source = record?.record || record || {};
    const isItem = source.kind === 'item';
    const completed = ['completed', 'settled', 'returned'].includes(source.status);
    const isLoan = source.kind === 'money';
    const amount = source.amount ?? source.balance;
    const confirmed = source.record_participants?.some((person) => person.role === 'recipient' && person.confirmed_at);
    const currency = source.currency === 'IRR' ? 'ریال' : 'تومان';
root.innerHTML = `<main class="shared-flow"><section class="shared-flow__card" aria-live="polite"><h1>${text(source.title || 'رکورد اشتراکی')}</h1><div class="shared-flow__status">${completed ? 'تسویه شد' : text(source.status_label || 'در انتظار اقدام')}</div><div class="shared-flow__rows"><div class="shared-flow__row"><span class="shared-flow__label">نوع</span><strong>${kind(source.kind)}</strong></div>${amount !== undefined && amount !== null ? `<div class="shared-flow__row"><span class="shared-flow__label">مبلغ</span><strong>${money(amount)} ${currency}</strong></div>` : ''}<div class="shared-flow__row"><span class="shared-flow__label">سررسید</span><strong>${date(source.due_at || source.dueAt)}</strong></div></div>${completed ? '' : `<div class="shared-flow__actions">${actionButton('confirm-receipt', 'تأیید دریافت', true)}${isItem ? actionButton('request-return', 'درخواست تأیید بازگشت') : ''}${actionButton('show-extension', 'درخواست تمدید')}${isLoan ? actionButton('show-repayment', 'ثبت پرداخت') : ''}</div><form class="shared-flow__form" data-workflow-form="extension" hidden><input name="dueAt" type="datetime-local" aria-label="موعد جدید" required><button class="shared-flow__primary" type="submit">ارسال درخواست</button></form><form class="shared-flow__form" data-workflow-form="repayment" hidden><input name="amount" type="number" inputmode="decimal" min="1" aria-label="مبلغ پرداخت" required><button class="shared-flow__primary" type="submit">ثبت پرداخت</button></form>`}<p class="shared-flow__notice" role="status"></p></section></main>`;
    root.querySelectorAll('[data-workflow-action]').forEach((button) => button.addEventListener('click', onAction));
    root.querySelectorAll('[data-workflow-form]').forEach((form) => form.addEventListener('submit', onForm));
    if (confirmed) root.querySelector('[data-workflow-action="confirm-receipt"]')?.remove();
    root.querySelector('.shared-flow__status').innerHTML = `${icon(completed || confirmed ? 'check-circle' : 'clock')} ${completed ? 'تسویه شد' : confirmed ? 'دریافت تأیید شد' : 'در انتظار تأیید دریافت'}`;
    if (source.card?.number) {
      const cardRow = document.createElement('div');
      cardRow.className = 'shared-flow__row';
      cardRow.innerHTML = `<span class="shared-flow__label">شماره کارت</span><strong dir="ltr">${text(source.card.number.replace(/(.{4})(?=.)/g, '$1 '))}</strong>`;
      root.querySelector('.shared-flow__rows').append(cardRow);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'shared-flow__secondary';
      copy.innerHTML = `${icon('copy')} کپی شماره کارت`;
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(source.card.number); copy.innerHTML = `${icon('check')} کپی شد`; }
        catch { feedback('کپی انجام نشد؛ شماره کارت را انتخاب و کپی کنید.', 'error'); }
      });
      root.querySelector('.shared-flow__rows').after(copy);
    }
  };

  const feedback = (message, state = '') => {
    const notice = root.querySelector('.shared-flow__notice');
    notice.textContent = message;
    notice.dataset.state = state;
  };

  const refresh = async () => {
    const current = ++revision;
    const result = await window.BedehWorkflow.shared(token);
    if (current !== revision || token !== tokenFromHash()) return;
    record = result;
    render();
  };

  async function send(button, action, payload = {}) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await window.BedehWorkflow.recipient(token, action, payload);
      await refresh();
      feedback(action === 'confirm-receipt' ? 'دریافت تأیید شد.' : action === 'request-return' ? 'درخواست بازگشت ارسال شد.' : action === 'request-extension' ? 'درخواست تمدید ارسال شد.' : 'پرداخت ثبت شد.', 'success');
    } catch (error) {
      if (['expired', 'revoked', 'invalid'].includes(error.code)) return open(token, true);
      feedback(error.message || 'عملیات انجام نشد.', 'error');
      button.disabled = false;
    }
  }

  function onAction(event) {
    const button = event.currentTarget;
    const action = button.dataset.workflowAction;
    if (action === 'show-extension' || action === 'show-repayment') {
      root.querySelector(`[data-workflow-form="${action.replace('show-', '')}"]`).hidden = false;
      return;
    }
    send(button, action);
  }

  function onForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type=submit]');
    if (form.dataset.workflowForm === 'extension') {
      const dueAt = new FormData(form).get('dueAt');
      if (!dueAt) return feedback('موعد جدید را وارد کنید.', 'error');
      return send(submit, 'request-extension', { dueAt: new Date(dueAt).toISOString() });
    }
    const amount = Number(new FormData(form).get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return feedback('مبلغ پرداخت معتبر نیست.', 'error');
    const source = record.record || record;
    const payerName = source.record_participants?.find((person) => person.role === 'recipient')?.display_name;
    return send(submit, 'record-repayment', { amount, payerName });
  }

  async function open(nextToken = tokenFromHash(), force = false) {
    if (!nextToken) return;
    if (!force && token === nextToken && root?.querySelector('.shared-flow')) return loading;
    token = nextToken;
    root = document.querySelector('#app') || document.body;
    root.innerHTML = '<main class="shared-flow"><section class="shared-flow__card" aria-busy="true"><p role="status">در حال بارگذاری…</p></section></main>';
    loading = refresh().catch((error) => {
      const unavailable = ['expired', 'revoked', 'invalid'].includes(error.code);
      const message = error instanceof TypeError ? 'اتصال برقرار نشد؛ دوباره تلاش کنید.' : error.message || 'اتصال برقرار نشد.';
      root.innerHTML = `<main class="shared-flow"><section class="shared-flow__card"><h1>${unavailable ? 'لینک در دسترس نیست' : 'بارگذاری انجام نشد'}</h1><p class="shared-flow__notice" role="alert" data-state="error">${text(message)}</p>${unavailable ? '' : '<button type="button" class="shared-flow__primary" data-shared-retry>تلاش دوباره</button>'}</section></main>`;
      root.querySelector('[data-shared-retry]')?.addEventListener('click', () => open(token, true));
    }).finally(() => { loading = null; });
    return loading;
  }

  function boot() {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    open();
  }

  window.BedehShared = { open };
  window.addEventListener('hashchange', () => { if (tokenFromHash()) open(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
