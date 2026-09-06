/* A real progressive replacement for the legacy record form. Each screen owns
   its fields; changing the record type rebuilds the step model safely. */
(function () {
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]);
  const tehranDate = () => Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts().filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const todayParts = tehranDate();
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const controlId = (name) => `wizard-${name}`;
  const field = (label, name, control, optional = false) => `<section class="record-step" data-optional="${optional}"><label class="record-step__label" for="${controlId(name)}">${label}</label>${control}</section>`;
  const group = (label, control, optional = false) => `<fieldset class="record-step record-step--group" data-optional="${optional}"><legend class="record-step__label">${label}</legend>${control}</fieldset>`;
  const input = (name, placeholder = '', required = false, attrs = '') => `<input id="${controlId(name)}" name="${name}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${attrs}>`;
  const cardStep = () => group('کارت دریافت وجه', `<div class="record-step__stack"><label class="sr-only" for="${controlId('cardNumber')}">شماره کارت</label>${input('cardNumber', 'شماره کارت ۱۶ رقمی', false, 'inputmode="numeric" maxlength="19" autocomplete="off"')}<label class="sr-only" for="${controlId('cardHolder')}">نام دارندهٔ کارت</label>${input('cardHolder', 'نام دارندهٔ کارت')}</div><span class="field-error"></span>`, true);
  const optionalStep = () => group('جزئیات اختیاری', `<div class="record-step__stack"><label class="sr-only" for="${controlId('note')}">یادداشت</label><textarea id="${controlId('note')}" name="note" placeholder="یادداشت"></textarea><small>یادآوری‌ها از تنظیمات حساب شما کنترل می‌شوند.</small></div>`, true);
  const steps = (type) => {
    const base = [field('نوع بده‌بستان', 'type', `<select name="type" id="wizard-type"><option value="item" ${type === 'item' ? 'selected' : ''}>امانت</option><option value="money" ${type === 'money' ? 'selected' : ''}>وام</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>هزینهٔ مشترک</option></select>` )];
    if (type === 'item') return base.concat([
      field('نام وسیله', 'item', input('item', 'مثلاً دستهٔ PS5', true)),
      field('امانت‌گیرنده', 'person', input('person', 'نام شخص', true)),
      field('تاریخ سررسید', 'due', input('due', '', true, `type="date" min="${today}"`)),
      field('وضعیت هنگام تحویل', 'condition', input('condition', 'مثلاً سالم و بدون خط'), true), optionalStep(),
    ]);
    if (type === 'money') return base.concat([
      field('نام شخص', 'person', input('person', 'نام شخص', true)),
      field('مبلغ', 'amount', `<div class="record-step__split">${input('amount', '۵۰۰۰۰۰', true, 'inputmode="numeric"')}<label class="sr-only" for="${controlId('currency')}">واحد پول</label><select id="${controlId('currency')}" name="currency"><option>تومان</option><option>ریال</option></select></div>`),
      group('نقش شما', '<p>شما قرض‌دهنده هستید؛ حسابی که دعوت را می‌پذیرد قرض‌گیرنده می‌شود.</p><input type="hidden" name="direction" value="lent">'),
      field('تاریخ سررسید', 'due', input('due', '', true, `type="date" min="${today}"`)), cardStep(), optionalStep(),
    ]);
    return base.concat([
      field('عنوان هزینه', 'title', input('title', 'مثلاً اتاق فرار', true)),
      field('مبلغ کل', 'amount', `<div class="record-step__split">${input('amount', '۱۲۰۰۰۰۰', true, 'inputmode="numeric"')}<label class="sr-only" for="${controlId('currency')}">واحد پول</label><select id="${controlId('currency')}" name="currency"><option>تومان</option><option>ریال</option></select></div>`),
      field('افراد و مبلغ سهم', 'shares', '<textarea id="wizard-shares" name="shares" required placeholder="علی: ۴۰۰۰۰۰&#10;سارا: ۸۰۰۰۰۰" aria-describedby="shares-help"></textarea><small id="shares-help">هر نفر در یک خط: نام و مبلغ سهم. جمع سهم‌ها باید برابر مبلغ کل و با همان واحد پول باشد. شما پرداخت‌کنندهٔ اولیه هستید.</small>'),
      field('تاریخ سررسید', 'due', input('due', '', true, `type="date" min="${today}"`)), cardStep(), optionalStep(),
    ]);
  };
  function renderWizard(type = 'item') {
    const model = steps(type);
    showSheet('ثبت بده‌بستان', `<form id="record-form" class="record-wizard" novalidate aria-describedby="wizard-error"><header class="record-wizard__header"><span class="record-wizard__count" aria-live="polite">گام ۱ از ${model.length}</span><i class="ph ph-steps" aria-hidden="true"></i></header><div class="record-wizard__track" role="progressbar" aria-label="پیشرفت ثبت بده‌بستان" aria-valuemin="1" aria-valuemax="${model.length}" aria-valuenow="1"><span></span></div><div class="record-wizard__steps">${model.join('')}</div><p class="field-error" id="wizard-error" role="alert"></p><footer class="record-wizard__actions"><button class="secondary-btn wizard-back" type="button"><i class="ph ph-arrow-right" aria-hidden="true"></i> قبلی</button><button class="secondary-btn wizard-skip" type="button"><i class="ph ph-arrow-bend-down-left" aria-hidden="true"></i> رد کردن</button><button class="primary-btn wizard-next" type="button">بعدی <i class="ph ph-arrow-left" aria-hidden="true"></i></button><button id="save-record" class="primary-btn wizard-submit" type="submit">ثبت و ساخت لینک <i class="ph ph-check" aria-hidden="true"></i></button></footer></form>`);
    const form = sheet.querySelector('#record-form'); const all = [...form.querySelectorAll('.record-step')]; let index = 0;
    const back = form.querySelector('.wizard-back'), skip = form.querySelector('.wizard-skip'), next = form.querySelector('.wizard-next'), submit = form.querySelector('.wizard-submit');
    const draw = () => {
      all.forEach((step, position) => { step.hidden = position !== index; });
      const optional = all[index].dataset.optional === 'true';
      form.querySelector('.record-wizard__count').textContent = `گام ${index + 1} از ${all.length}`;
      form.querySelector('.record-wizard__track span').style.width = `${((index + 1) / all.length) * 100}%`;
      form.querySelector('.record-wizard__track').setAttribute('aria-valuenow', String(index + 1));
      back.hidden = index === 0; skip.hidden = !optional; next.hidden = index === all.length - 1; submit.hidden = index !== all.length - 1;
      all[index].querySelector('input,select,textarea')?.focus({ preventScroll: true });
    };
    const validate = () => {
      const error = form.querySelector('#wizard-error');
      const invalid = [...all[index].querySelectorAll('input,select,textarea')].find((control) => !control.checkValidity());
      if (!invalid) { error.textContent = ''; return true; }
      invalid.setAttribute('aria-invalid', 'true');
      error.textContent = 'این فیلد را کامل کنید.';
      invalid.focus({ preventScroll: true });
      return false;
    };
    next.onclick = () => { if (validate()) { index += 1; draw(); } };
    back.onclick = () => { index = Math.max(0, index - 1); draw(); };
    skip.onclick = () => { all[index].querySelectorAll('input,textarea').forEach((control) => { control.value = ''; }); index = Math.min(all.length - 1, index + 1); draw(); };
    form.querySelector('#wizard-type').onchange = (event) => renderWizard(event.target.value);
    form.addEventListener('input', (event) => { event.target.removeAttribute('aria-invalid'); form.querySelector('#wizard-error').textContent = ''; });
    form.onsubmit = (event) => submitRecord(event);
    draw();
  }
  // This replaces the global entry point used by the existing "ثبت جدید" controls.
  window.newRecordForm = () => renderWizard('item');
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-new-record-wizard],[data-action="new-record"]');
    if (button) { event.preventDefault(); event.stopImmediatePropagation(); renderWizard('item'); }
  }, true);
}());
