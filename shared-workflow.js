(() => {
  const tokenFromHash = () => {
    const match = location.hash.match(/(?:^#|&)share=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const text = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const money = (value) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
  const kind = (value) => ({ item: 'امانت', loan: 'قرض', expense: 'هزینهٔ مشترک' }[value] || 'بده‌بستان');
  const date = (value) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value)) : '—';

  const styles = `
    .shared-flow{min-height:100dvh;background:#1e1e1e;color:#fff;display:grid;place-items:center;padding:24px;font-family:Vazirmatn,system-ui,sans-serif;direction:rtl}
    .shared-flow__card{width:min(100%,560px);background:#252525;border:1px solid #3d3d3d;border-radius:16px;padding:24px;box-shadow:0 18px 48px #0006}
    .shared-flow__eyebrow{font-size:13px;color:#b9c5d8;margin:0 0 8px}.shared-flow h1{font-size:23px;line-height:1.5;margin:0 0 20px}.shared-flow__rows{display:grid;gap:0;border-block:1px solid #3d3d3d;margin:20px 0}.shared-flow__row{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid #353535}.shared-flow__row:last-child{border:0}.shared-flow__label{color:#b9c5d8}.shared-flow__status{display:inline-flex;align-items:center;gap:7px;color:#9bd6ff;font-size:14px}.shared-flow__status::before{content:'';width:8px;height:8px;border-radius:99px;background:#00ffff}.shared-flow__actions{display:grid;gap:10px}.shared-flow button{min-height:44px;border-radius:10px;border:1px solid #48515d;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;transition:background .18s ease,border-color .18s ease,transform .18s ease}.shared-flow button:focus-visible,.shared-flow input:focus-visible{outline:3px solid #0066ff;outline-offset:2px}.shared-flow button:active{transform:translateY(1px)}.shared-flow button[disabled]{opacity:.58;cursor:wait}.shared-flow__primary{background:#0066ff;color:#fff;border-color:#0066ff!important}.shared-flow__secondary{background:#2d2d2d;color:#fff}.shared-flow__notice{min-height:22px;margin:16px 0 0;color:#b9c5d8;font-size:14px}.shared-flow__notice[data-state=success]{color:#96e8ba}.shared-flow__notice[data-state=error]{color:#ffb4b4}.shared-flow__form{display:grid;grid-template-columns:1fr auto;gap:8px}.shared-flow input{min-height:44px;box-sizing:border-box;border:1px solid #555;border-radius:10px;background:#1e1e1e;color:#fff;padding:0 12px;font:inherit}@media(max-width:420px){.shared-flow{padding:16px}.shared-flow__card{padding:20px}.shared-flow__form{grid-template-columns:1fr}}
  `;

  let token;
  let root;
  let record;

  const actionButton = (action, label, primary = false) => `<button type="button" data-workflow-action="${action}" class="${primary ? 'shared-flow__primary' : 'shared-flow__secondary'}">${label}</button>`;

  const render = () => {
    const source = record?.record || record || {};
    const isItem = source.kind === 'item';
    const completed = source.status === 'completed';
    const isLoan = source.kind === 'loan';
    const amount = source.amount ?? source.balance;
    root.innerHTML = `<main class="shared-flow"><section class="shared-flow__card" aria-live="polite"><p class="shared-flow__eyebrow">بده‌بستان</p><h1>${text(source.title || 'رکورد اشتراکی')}</h1><div class="shared-flow__status">${completed ? 'تسویه شد' : text(source.status_label || 'در انتظار اقدام')}</div><div class="shared-flow__rows"><div class="shared-flow__row"><span class="shared-flow__label">نوع</span><strong>${kind(source.kind)}</strong></div>${amount !== undefined && amount !== null ? `<div class="shared-flow__row"><span class="shared-flow__label">مبلغ</span><strong>${money(amount)} تومان</strong></div>` : ''}<div class="shared-flow__row"><span class="shared-flow__label">سررسید</span><strong>${date(source.due_at || source.dueAt)}</strong></div></div>${completed ? '' : `<div class="shared-flow__actions">${actionButton('confirm-receipt', 'تأیید دریافت', true)}${isItem ? actionButton('request-return', 'درخواست تأیید بازگشت') : ''}${actionButton('show-extension', 'درخواست تمدید')}${isLoan ? actionButton('show-repayment', 'ثبت پرداخت') : ''}</div><form class="shared-flow__form" data-workflow-form="extension" hidden><input name="dueAt" type="datetime-local" aria-label="موعد جدید" required><button class="shared-flow__primary" type="submit">ارسال درخواست</button></form><form class="shared-flow__form" data-workflow-form="repayment" hidden><input name="amount" type="number" inputmode="decimal" min="1" aria-label="مبلغ پرداخت" required><button class="shared-flow__primary" type="submit">ثبت پرداخت</button></form>`}<p class="shared-flow__notice" role="status"></p></section></main>`;
    root.querySelectorAll('[data-workflow-action]').forEach((button) => button.addEventListener('click', onAction));
    root.querySelectorAll('[data-workflow-form]').forEach((form) => form.addEventListener('submit', onForm));
  };

  const feedback = (message, state = '') => {
    const notice = root.querySelector('.shared-flow__notice');
    notice.textContent = message;
    notice.dataset.state = state;
  };

  const refresh = async () => {
    record = await window.BedehWorkflow.shared(token);
    render();
  };

  async function send(button, action, payload = {}) {
    button.disabled = true;
    try {
      await window.BedehWorkflow.recipient(token, action, payload);
      await refresh();
      feedback(action === 'confirm-receipt' ? 'دریافت تأیید شد.' : action === 'request-return' ? 'درخواست بازگشت ارسال شد.' : action === 'request-extension' ? 'درخواست تمدید ارسال شد.' : 'پرداخت ثبت شد.', 'success');
    } catch (error) {
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
    return send(submit, 'record-repayment', { amount });
  }

  async function boot() {
    token = tokenFromHash();
    if (!token) return;
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    root = document.querySelector('#app') || document.body;
    root.innerHTML = '<main class="shared-flow"><section class="shared-flow__card"><p class="shared-flow__notice">در حال بارگذاری…</p></section></main>';
    try {
      await refresh();
    } catch (error) {
      root.innerHTML = `<main class="shared-flow"><section class="shared-flow__card"><h1>دسترسی به رکورد ممکن نیست</h1><p class="shared-flow__notice" data-state="error">${text(error.message || 'لینک معتبر نیست یا غیرفعال شده است.')}</p></section></main>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
