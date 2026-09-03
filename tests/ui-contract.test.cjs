const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('loads product enhancements after the core and backend clients', () => {
  const html = read('index.html');
  const core = html.indexOf('product-core.js');
  const backend = html.indexOf('backend-client.js');
  const enhancements = html.indexOf('product-enhancements.js');
  assert.ok(core >= 0 && backend >= 0 && enhancements >= 0);
  assert.ok(core < enhancements && backend < enhancements);
  assert.match(html, /product-enhancements\.css/);
});

test('ships every requested UI capability from one enhancement layer', () => {
  const source = read('product-enhancements.js');
  for (const contract of [
    'decorateTopbar',
    'data-completed-filter',
    'tip-ticker',
    'jalali-picker',
    'account-form',
    'receipt-file',
    'uploadReceipt',
    'create-receipt-download',
    'routeAccountEntry',
    'formatPersianYear',
    'tip-ticker__group',
    'data-ticker-toggle',
    'data-password-toggle',
    'aria-current',
    'enhanceDialog',
  ]) assert.ok(source.includes(contract), `missing ${contract}`);
});

test('defines a complete semantic light theme and reduced-motion ticker fallback', () => {
  const css = read('product-enhancements.css');
  assert.match(css, /:root\[data-theme=["']light["']\]/);
  assert.match(css, /--bg:/);
  assert.match(css, /--surface:/);
  assert.match(css, /--text:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /::selection/);
  assert.match(css, /scrollbar-color/);
  assert.match(css, /\.password-control/);
  assert.match(css, /dialog::backdrop/);
});

test('account creation is direct and has no email-confirmation recovery copy', () => {
  const source = read('product-enhancements.js');
  assert.doesNotMatch(source, /در انتظار تأیید ایمیل|ایمیل تأیید|درخواست لینک تازه|ارسال دوباره/);
  assert.match(source, /حساب ساخته شد و وارد شدید/);
  assert.match(source, /ساخت حساب کامل نشد/);
});

test('keeps enhancement assets available offline with a new cache version', () => {
  const sw = read('sw.js');
  assert.match(sw, /bedeh-bestan-v28/);
  assert.match(sw, /product-core\.js/);
  assert.match(sw, /product-enhancements\.js/);
  assert.match(sw, /product-enhancements\.css/);
});

test('keeps all five mobile destinations in-bounds and the desktop create action singular', () => {
  const css = read('ui-cleanup.css');
  const app = read('app.js');
  assert.match(css, /repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.fab\.has-phosphor-icon\{display:none!important\}/);
  assert.match(css, /\.home-create-action\{display:none!important\}/);
  assert.match(app, /home-create-action/);
});

test('wizard fields expose connected labels, grouped choices, progress, and Tehran date boundaries', () => {
  const source = read('record-wizard-v2.js');
  assert.match(source, /for="\$\{controlId\(name\)\}"/);
  assert.match(source, /<fieldset class="record-step record-step--group"/);
  assert.match(source, /<legend class="record-step__label">/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuenow/);
  assert.match(source, /timeZone: 'Asia\/Tehran'/);
});
