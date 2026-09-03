/* Keeps product copy purposeful and applies the single Phosphor icon vocabulary
   to both the authenticated interface and legacy routes while they transition. */
(function () {
  const removeCopy = new Set([
    'تعهدهای نزدیک‌تر در ابتدا آمده‌اند.',
    'همه چیز در یک نمای روشن مرتب شده است.',
    'برای مدیریت بهتر، وضعیت‌ها را اینجا ببین.',
    'هر مورد، یک سابقه قابل پیگیری دارد.',
    'هر مورد، یک سابقهٔ روشن برای همهٔ افراد درگیر دارد.',
    'یادآوری‌ها فقط برای موارد نزدیک یا گذشته از سررسید هستند.',
    'لینک و QR فقط به همان رکورد دسترسی می‌دهند.',
    'این کارت فقط برای دریافت وجه ثبت شده و مالکیت آن تأیید نشده است.',
    'ثبت روشن و مشترک تعهدها',
    'کنترل داده، یادآوری و نمایش در اختیار شماست.',
    'سطح‌های تیره و کنتراست مناسب در محیط کم‌نور.',
    'نمایش کم‌نور با کنتراست بالا.',
    'سه روز مانده، فردا، امروز و پس از سررسید.',
    'فقط رکوردهای این مرورگر صادر می‌شوند.',
  ]);
  const icons = [
    ['خانه', 'house'], ['همه', 'house'], ['بده‌بستان‌ها', 'gift'], ['امانت‌ها', 'handshake'], ['قرض‌ها', 'banknote'], ['دنگ‌ها', 'users-three'],
    ['اعلان‌ها', 'bell'], ['تنظیمات', 'gear-six'], ['ثبت جدید', 'plus'], ['ثبت بده‌بستان', 'plus'], ['نمایش QR', 'qr-code'],
    ['کپی لینک', 'copy'], ['کپی شماره کارت', 'copy'], ['اشتراک‌گذاری', 'share-network'],
    ['تغییر موعد', 'calendar-clock'], ['موعد گذشته', 'warning-circle'], ['تسویه شد', 'check-circle'],
    ['لینک غیرفعال', 'link-break'], ['غیرفعال‌سازی', 'link-break'], ['ویرایش', 'pencil-simple'],
    ['حذف', 'trash'], ['بازگشت', 'arrow-right'], ['بستن', 'x'],
  ];
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const important = (value) => /خطا|نامعتبر|غیرفعال|منقضی|دسترسی|ذخیره نشد|ثبت شد|پرداخت ثبت شد|کپی شد|بازگشت‌پذیر نیست|حذف می‌شود|اجباری|موعد گذشته|امروز|فردا|مانده/.test(value);
  const filler = (value) => /^(هر مورد، یک سابقه|یادآوری‌ها فقط|تعهدهای نزدیک‌تر|همه چیز در یک نمای|برای مدیریت بهتر|در این بخش|این صفحه|اینجا می‌توانید)/.test(value);
  function clean(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach((textNode) => {
      const value = normalize(textNode.nodeValue);
      if (value === 'وضعیت امروز') textNode.nodeValue = 'تعهدها';
      if (removeCopy.has(value)) {
        const container = textNode.parentElement?.closest('p, small, .subtitle, .helper, .top-meta');
        if (container) container.remove(); else textNode.remove();
      }
    });
    root.querySelectorAll('.subtitle,.page-subtitle,.helper,.description,[data-ui-copy="helper"]').forEach((element) => {
      const value = normalize(element.textContent);
      if (filler(value) && !important(value)) element.remove();
    });
    root.querySelectorAll('h1,h2').forEach((heading) => {
      const sibling = heading.nextElementSibling;
      if (sibling?.matches('p,small,.subtitle,.page-subtitle')) {
        const value = normalize(sibling.textContent);
        if (filler(value) && !important(value)) sibling.remove();
      }
    });
    root.querySelectorAll('a,button,[role="button"],label').forEach((element) => {
      if (element.querySelector('.ph')) return;
      const label = normalize(element.textContent);
      const match = icons.find(([name]) => label === name || label.startsWith(`${name} `));
      if (!match) return;
      const icon = document.createElement('i');
      icon.className = `ph ph-${match[1]}`;
      icon.setAttribute('aria-hidden', 'true');
      element.prepend(icon);
      element.classList.add('has-phosphor-icon');
    });
    root.querySelectorAll('button:not([aria-label])').forEach((button) => {
      if (normalize(button.textContent)) return;
      const ph = button.querySelector('[class*="ph-"]');
      if (ph) button.setAttribute('aria-label', 'عملیات');
    });
  }
  clean(document.body);
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) clean(node);
  }))).observe(document.body, { childList: true, subtree: true });
}());
