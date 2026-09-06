/* Shared, draft-preserving inputs and opt-out interaction feedback. */
(function () {
  const core = window.BedehProductCore;
  const clean = (value) => core.asciiDigits(value || '').replace(/\D/g, '');
  const number = (value) => Number(clean(value));
  const escape = (v) => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const amountSelector = 'input[name="amount"],input[data-share-amount]';
  function formatAmount(input) {
    const pos = input.selectionStart ?? input.value.length;
    const digitsBefore = clean(input.value.slice(0,pos)).length;
    const digits = clean(input.value).replace(/^0+(?=\d)/,'');
    input.value = digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g,'٬').replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]) : '';
    let cursor=0, seen=0;
    while(cursor<input.value.length && seen<digitsBefore) { if(/[۰-۹]/.test(input.value[cursor])) seen++; cursor++; }
    if(document.activeElement===input) input.setSelectionRange(cursor,cursor);
  }
  function editor() {
    return `<div class="share-editor" data-share-editor><div data-share-rows></div><div class="actions"><button type="button" class="secondary-btn" data-add-person><i class="ph ph-user-plus" aria-hidden="true"></i> یه نفر دیگه</button><button type="button" class="text-btn" data-split-even>مساوی تقسیم کن</button></div><p data-share-total role="status"></p><input type="hidden" name="shares"><small>اسم هر نفر و سهمش را بنویس؛ اگر سهم‌ها برابرند، «مساوی تقسیم کن» را بزن. مبلغ‌ها با واحد پول همین دنگ هستند.</small></div>`;
  }
  function row(name='',amount='') {
    const id=crypto.randomUUID();
    return `<div class="share-editor-row"><div><label for="person-${id}">اسم</label><input id="person-${id}" data-share-name required maxlength="80" autocomplete="off" value="${escape(name)}" placeholder="مثلاً محسن"></div><div><label for="amount-${id}">سهم</label><input id="amount-${id}" data-share-amount required inputmode="numeric" value="${escape(amount)}" placeholder="۰"></div><button type="button" class="icon-btn" data-remove-person aria-label="حذف این نفر"><i class="ph ph-x" aria-hidden="true"></i></button></div>`;
  }
  function updateEditor(root) {
    const rows=[...root.querySelectorAll('.share-editor-row')];
    const names=new Set();
    rows.forEach(r=>{
      const input=r.querySelector('[data-share-name]'), name=input.value.trim();
      input.setCustomValidity(name && names.has(name) ? 'برای دو نفر هم‌نام، نام خانوادگی یا یک نشانه اضافه کن.' : '');
      names.add(name);
      const amount=r.querySelector('[data-share-amount]');
      amount.setCustomValidity(amount.value && (!Number.isSafeInteger(number(amount.value)) || number(amount.value)<=0) ? 'سهم باید عددی بیشتر از صفر باشد.' : '');
    });
    root.querySelector('[name="shares"]').value=rows.map(r=>`${r.querySelector('[data-share-name]').value.trim()}: ${clean(r.querySelector('[data-share-amount]').value)}`).join('\n');
    const total=rows.reduce((n,r)=>n+number(r.querySelector('[data-share-amount]').value),0);
    const totalInput=root.closest('form')?.querySelector('input[name="amount"]');
    const expected=totalInput ? number(totalInput.value) : Number(root.closest('form')?.dataset.total || 0);
    const note=root.querySelector('[data-share-total]');
    note.textContent=`جمع سهم‌ها: ${new Intl.NumberFormat('fa-IR').format(total)}${expected ? ' از '+new Intl.NumberFormat('fa-IR').format(expected) : ''}`;
    const last=rows.at(-1)?.querySelector('[data-share-amount]');
    if(last && expected && total!==expected) last.setCustomValidity('جمع سهم‌ها باید با مبلغ کل یکی باشد.');
  }
  function mount(root) {
    root.querySelectorAll?.('[data-share-editor]:not([data-ready])').forEach(editor=>{
      editor.dataset.ready='true'; editor.querySelector('[data-share-rows]').innerHTML=row()+row();
      updateEditor(editor);
    });
  }
  document.addEventListener('input',(event)=>{
    if(event.isComposing) return;
    if(event.target.matches(amountSelector)) formatAmount(event.target);
    const root=event.target.closest('[data-share-editor]');
    if(root) updateEditor(root);
    else if(event.target.matches('input[name="amount"]')) event.target.closest('form')?.querySelectorAll('[data-share-editor]').forEach(updateEditor);
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter' || event.isComposing || !event.target.matches('[data-share-name],[data-share-amount]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const current=event.target.closest('.share-editor-row');
    if(event.target.matches('[data-share-name]')) current.querySelector('[data-share-amount]').focus();
    else if(current.nextElementSibling) current.nextElementSibling.querySelector('[data-share-name]').focus();
    else current.closest('[data-share-editor]').querySelector('[data-add-person]').click();
  },true);
  document.addEventListener('click',(event)=>{
    const button=event.target.closest('[data-add-person],[data-remove-person],[data-split-even]');
    if(!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const editor=button.closest('[data-share-editor]');
    if(button.hasAttribute('data-add-person')) {
      if(editor.querySelectorAll('.share-editor-row').length>=100) { window.notice('تا ۱۰۰ نفر می‌توانی اضافه کنی.'); return; }
      editor.querySelector('[data-share-rows]').insertAdjacentHTML('beforeend',row());
      editor.querySelector('.share-editor-row:last-child [data-share-name]').focus();
    } else if(button.hasAttribute('data-remove-person')) {
      if(editor.querySelectorAll('.share-editor-row').length>1) button.closest('.share-editor-row').remove();
    } else {
      const form=editor.closest('form');
      const total=number(form.querySelector('input[name="amount"]')?.value || form.dataset.total);
      const amounts=[...editor.querySelectorAll('[data-share-amount]')];
      if(total<amounts.length) { window.notice('اول مبلغ کل رو وارد کن.'); return; }
      amounts.forEach((input,i)=>{ input.value=String(Math.floor(total/amounts.length)+(i<total%amounts.length?1:0)); formatAmount(input); });
    }
    updateEditor(editor);
  },true);
  new MutationObserver(records=>records.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1) mount(n.parentElement || n);}))).observe(document.body,{childList:true,subtree:true});

  let audio=null, lastSound=0;
  const enabled=()=>localStorage.getItem('bedeh-notification-sound')!=='off';
  function unlock() {
    if(!enabled()) return;
    const Audio=window.AudioContext || window.webkitAudioContext;
    if(!Audio) return;
    audio ||= new Audio();
    if(audio.state==='suspended') audio.resume().catch(()=>{});
  }
  document.addEventListener('pointerdown',unlock,{passive:true});
  document.addEventListener('keydown',unlock);
  document.addEventListener('click',(event)=>{
    if(event.target.closest('[data-theme-setting]')) {
      event.preventDefault();event.stopImmediatePropagation();
      window.BedehEnhancements.setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
    }
  },true);
  document.addEventListener('change',(event)=>{
    if(event.target.matches('[data-sound-setting]')) window.BedehFriendly.setSound(event.target.checked);
  });
  function chime() {
    if(!enabled() || !audio || audio.state!=='running' || Date.now()-lastSound<2000) return;
    lastSound=Date.now();
    const start=audio.currentTime;
    [660,880].forEach((frequency,i)=>{
      const oscillator=audio.createOscillator(), gain=audio.createGain(), at=start+i*.11;
      oscillator.type='sine'; oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,at); gain.gain.linearRampToValueAtTime(.08,at+.015); gain.gain.exponentialRampToValueAtTime(.001,at+.24);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(at); oscillator.stop(at+.26);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    });
  }
  window.BedehFriendly={ editor,formatAmount,chime,soundEnabled:enabled,setSound(value){localStorage.setItem('bedeh-notification-sound',value?'on':'off');if(value){unlock();chime();}} };
}());
