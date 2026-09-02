/* Converts the existing record form into a progressive, one-field-at-a-time
   flow without replacing its native validation or submit handler. */
(function () {
  const q = (root, selector) => root.querySelector(selector);
  const fields = (form) => [...form.querySelectorAll('input,select,textarea')]
    .filter((field) => field.type !== 'hidden' && !field.disabled && !field.closest('[hidden]'));
  const fieldBlock = (field, form) => {
    const candidate = field.closest('.field,.form-field,.input-group,fieldset,details,label');
    if (candidate && candidate !== form) return candidate;
    return field.parentElement !== form ? field.parentElement : field;
  };
  function enhance(dialog) {
    if (dialog.dataset.wizardReady || !dialog.open) return;
    const form = q(dialog, 'form'); if (!form) return;
    const controls = fields(form); if (controls.length < 2) return;
    dialog.dataset.wizardReady = 'true';
    const groups = controls.map((control) => ({ control, block: fieldBlock(control, form) }));
    const uniqueGroups = groups.filter((group, index) => groups.findIndex((other) => other.block === group.block) === index);
    const count = uniqueGroups.length;
    let current = 0;
    const progress = document.createElement('div');
    progress.className = 'wizard-progress';
    progress.innerHTML = '<div class="wizard-progress__row"><span class="wizard-progress__label"></span><i class="ph ph-list-numbers" aria-hidden="true"></i></div><div class="wizard-progress__track"><span></span></div>';
    form.prepend(progress);
    const actions = document.createElement('div');
    actions.className = 'wizard-actions';
    actions.innerHTML = '<button type="button" class="btn btn-ghost wizard-back"><i class="ph ph-arrow-right" aria-hidden="true"></i> بازگشت</button><button type="button" class="btn btn-ghost wizard-skip"><i class="ph ph-arrow-bend-down-left" aria-hidden="true"></i> رد کردن</button><button type="button" class="btn btn-primary wizard-next">ادامه <i class="ph ph-arrow-left" aria-hidden="true"></i></button>';
    form.append(actions);
    const submit = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')].find((button) => !actions.contains(button));
    if (submit) submit.classList.add('wizard-submit');
    const back = q(actions, '.wizard-back'); const skip = q(actions, '.wizard-skip'); const next = q(actions, '.wizard-next');
    const show = () => {
      uniqueGroups.forEach((group, index) => { group.block.hidden = index !== current; });
      const field = uniqueGroups[current].control;
      const isFinal = current === count - 1;
      progress.querySelector('.wizard-progress__label').textContent = `گام ${current + 1} از ${count}`;
      progress.querySelector('.wizard-progress__track>span').style.width = `${((current + 1) / count) * 100}%`;
      back.hidden = current === 0;
      skip.hidden = Boolean(field.required) || isFinal;
      next.hidden = isFinal;
      if (submit) submit.hidden = !isFinal;
      setTimeout(() => field.focus({ preventScroll: true }), 0);
    };
    next.addEventListener('click', () => { if (!uniqueGroups[current].control.reportValidity()) return; current += 1; show(); });
    back.addEventListener('click', () => { current = Math.max(0, current - 1); show(); });
    skip.addEventListener('click', () => { uniqueGroups[current].control.value = ''; current += 1; show(); });
    form.addEventListener('input', () => { if (submit && current === count - 1) submit.disabled = !uniqueGroups[current].control.checkValidity(); });
    show();
  }
  const inspect = () => document.querySelectorAll('dialog#sheet').forEach(enhance);
  new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  inspect();
}());
