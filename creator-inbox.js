(() => {
  const getMain = () => document.querySelector('#main') || document.querySelector('main');
  const normalise = (data) => Array.isArray(data) ? data : (data.notifications || data.data || []);
  const actionFor = (notification) => ({
    return_requested: { action: 'confirm-return', label: 'تأیید بازگشت' },
    extension_requested: { action: 'approve-extension', label: 'تأیید تمدید' },
  }[notification.kind]);

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  const render = (notifications) => {
    const main = getMain();
    if (!main) return;
    const cards = notifications.length ? notifications.map((notification) => {
      const action = actionFor(notification);
      return `<article class="creator-inbox__item"><div><strong>${escape(notification.title)}</strong>${notification.body ? `<p>${escape(notification.body)}</p>` : ''}</div>${action && notification.record_id ? `<button type="button" class="creator-inbox__action" data-creator-action="${action.action}" data-record-id="${notification.record_id}" data-notification-id="${notification.id}">${action.label}</button>` : ''}</article>`;
    }).join('') : '<p class="creator-inbox__empty">اعلان تازه‌ای ندارید.</p>';
    main.innerHTML = `<section class="creator-inbox" aria-live="polite"><h1>اعلان‌ها</h1>${cards}</section>`;
    main.querySelectorAll('[data-creator-action]').forEach((button) => button.addEventListener('click', confirm));
  };

  async function confirm(event) {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'در حال ثبت…';
    try {
      await window.BedehWorkflow.creator(button.dataset.creatorAction, { recordId: button.dataset.recordId });
      await window.BedehWorkflow.command('mark-notification-read', { notificationId: button.dataset.notificationId });
      await load();
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      const message = document.createElement('p');
      message.className = 'creator-inbox__error';
      message.textContent = error.message || 'عملیات انجام نشد.';
      button.after(message);
    }
  }

  async function load() {
    const session = await window.BedehBackend?.session?.();
    if (!session?.access_token) return;
    const response = await window.BedehWorkflow.command('notifications');
    render(normalise(response));
  }

  const handleNavigation = (event) => {
    const button = event.target.closest('button');
    if (!button || !button.textContent.includes('اعلان‌ها')) return;
    window.setTimeout(() => load().catch(() => {}), 80);
  };

  const style = document.createElement('style');
  style.textContent = `.creator-inbox{max-width:760px;margin-inline:auto;display:grid;gap:12px}.creator-inbox h1{margin:0 0 8px;font-size:24px}.creator-inbox__item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border:1px solid #3d3d3d;border-radius:12px;background:#252525}.creator-inbox__item strong{font-size:15px}.creator-inbox__item p{margin:7px 0 0;color:#b9c5d8;font-size:14px}.creator-inbox__action{min-height:44px;flex:0 0 auto;background:#0066ff;color:#fff;border:1px solid #0066ff;border-radius:9px;padding:8px 12px;font:inherit;font-weight:700;cursor:pointer}.creator-inbox__action:focus-visible{outline:3px solid #00ffff;outline-offset:2px}.creator-inbox__action:disabled{opacity:.6}.creator-inbox__empty{margin:0;padding:24px;border:1px dashed #555;border-radius:12px;color:#b9c5d8;text-align:center}.creator-inbox__error{color:#ffb4b4!important}@media(max-width:560px){.creator-inbox__item{align-items:stretch;flex-direction:column}.creator-inbox__action{width:100%}}`;
  document.head.append(style);
  document.addEventListener('click', handleNavigation);
})();
