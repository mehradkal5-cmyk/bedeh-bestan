/* A real progressive replacement for the legacy record form. Each screen owns
   its fields; changing the record type rebuilds the step model safely. */
(function () {
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]);
  const today = new Date().toISOString().slice(0, 10);
  const field = (label, control, optional = false) => `<section class="record-step" data-optional="${optional}"><label class="record-step__label">${label}</label>${control}</section>`;
  const input = (name, placeholder = '', required = false, attrs = '') => `<input name="${name}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${attrs}>`;
  const cardStep = () => field('کارت دریافت وجه', `<div class="record-step__stack">${input('cardNumber', 'شماره کارت ۱۶ رقمی', false, 'inputmode="numeric" maxlength="19" autocomplete="off"')}${input('cardHolder', 'نام دارندهٔ کارت')}</div><span class="field-error"></span>`, true);
  const optionalStep = () => field('جزئیات اختیاری', `<div class="record-step__stack"><textarea name="note" placeholder="یادداشت"></textarea><select name="reminder"><option value="true">یادآوری فعال</option><option value="false">یادآوری غیرفعال</option></select></div>`, true);
  const steps = (type) => {
    const base = [field('نوع بده‌بستان', `<select name="type" id="wizard-type"><option value="item" ${type === 'item' ? 'selected' : ''}>امانت</option><option value="money" ${type === 'money' ? 'selected' : ''}>وام</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>هزینهٔ مشترک</option></select>` )];
    if (type === 'item') return base.concat([
      field('نام وسیله', input('item', 'مثلاً دستهٔ PS5', true)),
      field('امانت‌گیرنده', input('person', 'نام شخص', true)),
      field('تاریخ سررسید', input('due', '', true, `type="date" min="${today}"`)),
      field('وضعیت هنگام تحویل', input('condition', 'مثلاً سالم و بدون خط'), true), optionalStep(),
    ]);
    if (type === 'money') return base.concat([
      field('نام شخص', input('person', 'نام شخص', true)),
      field('مبلغ', `<div class="record-step__split">${input('amount', '۵۰۰۰۰۰', true, 'inputmode="numeric"')}<select name="currency"><option>تومان</option><option>ریال</option></select></div>`),
      field('جهت وام', `<div class="wizard-choice"><label><input type="radio" name="direction" value="lent" checked> به او دادم</label><label><input type="radio" name="direction" value="borrowed"> از او گرفتم</label></div>`),
      field('تاریخ سررسید', input('due', '', true, `type="date" min="${today}"`)), cardStep(), optionalStep(),
    ]);
    return base.concat([
      field('عنوان هزینه', input('title', 'مثلاً اتاق فرار', true)),
      field('مبلغ کل', `<div class="record-step__split">${input('amount', '۱۲۰۰۰۰۰', true, 'inputmode="numeric"')}<select name="currency"><option>تومان</option><option>ریال</option></select></div>`),
      field('شرکت‌کنندگان', input('participants', 'علی، سارا، مهدی', true)),
      field('پرداخت‌کنندهٔ اولیه', input('payer', 'نام شخص', true)),
      field('روش تقسیم', `<select name="split"><option value="equal">مساوی</option><option value="custom">سفارشی</option></select>`),
      field('تاریخ سررسید', input('due', '', true, `type="date" min="${today}"`)), cardStep(), optionalStep(),
    ]);
  };
  function renderWizard(type = 'item') {
    const model = steps(type);
    showSheet('ثبت بده‌بستان', `<form id="record-form" class="record-wizard" novalidate><header class="record-wizard__header"><span class="record-wizard__count">گام ۱ از ${model.length}</span><i class="ph ph-steps" aria-hidden="true"></i></header><div class="record-wizard__track" aria-hidden="true"><span></span></div><div class="record-wizard__steps">${model.join('')}</div><p class="field-error" id="wizard-error" role="alert"></p><footer class="record-wizard__actions"><button class="secondary-btn wizard-back" type="button"><i class="ph ph-arrow-right" aria-hidden="true"></i> قبلی</button><button class="secondary-btn wizard-skip" type="button"><i class="ph ph-arrow-bend-down-left" aria-hidden="true"></i> رد کردن</button><button class="primary-btn wizard-next" type="button">بعدی <i class="ph ph-arrow-left" aria-hidden="true"></i></button><button id="save-record" class="primary-btn wizard-submit" type="submit">ثبت و ساخت لینک <i class="ph ph-check" aria-hidden="true"></i></button></footer></form>`);
    const form = sheet.querySelector('#record-form'); const all = [...form.querySelectorAll('.record-step')]; let index = 0;
    const back = form.querySelector('.wizard-back'), skip = form.querySelector('.wizard-skip'), next = form.querySelector('.wizard-next'), submit = form.querySelector('.wizard-submit');
    const draw = () => {
      all.forEach((step, position) => { step.hidden = position !== index; });
      const optional = all[index].dataset.optional === 'true';
      form.querySelector('.record-wizard__count').textContent = `گام ${index + 1} از ${all.length}`;
      form.querySelector('.record-wizard__track span').style.width = `${((index + 1) / all.length) * 100}%`;
      back.hidden = index === 0; skip.hidden = !optional; next.hidden = index === all.length - 1; submit.hidden = index !== all.length - 1;
      all[index].querySelector('input,select,textarea')?.focus({ preventScroll: true });
    };
    const validate = () => [...all[index].querySelectorAll('input,select,textarea')].every((control) => control.checkValidity() ? true : (control.reportValidity(), false));
    next.onclick = () => { if (validate()) { index += 1; draw(); } };
    back.onclick = () => { index = Math.max(0, index - 1); draw(); };
    skip.onclick = () => { all[index].querySelectorAll('input,textarea').forEach((control) => { control.value = ''; }); index = Math.min(all.length - 1, index + 1); draw(); };
    form.querySelector('#wizard-type').onchange = (event) => renderWizard(event.target.value);
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
