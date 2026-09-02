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
    'data-resend-confirmation',
    'formatPersianYear',
    'tip-ticker__group',
    'data-ticker-toggle',
  ]) assert.ok(source.includes(contract), `missing ${contract}`);
});

test('defines a complete semantic light theme and reduced-motion ticker fallback', () => {
  const css = read('product-enhancements.css');
  assert.match(css, /:root\[data-theme=["']light["']\]/);
  assert.match(css, /--bg:/);
  assert.match(css, /--surface:/);
  assert.match(css, /--text:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('keeps enhancement assets available offline with a new cache version', () => {
  const sw = read('sw.js');
  assert.match(sw, /bedeh-bestan-v28/);
  assert.match(sw, /product-core\.js/);
  assert.match(sw, /product-enhancements\.js/);
  assert.match(sw, /product-enhancements\.css/);
});
