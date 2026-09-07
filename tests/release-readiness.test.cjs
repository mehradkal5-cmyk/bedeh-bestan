const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('private invitation tokens never leave the browser for QR generation', () => {
  for (const file of ['app.js', 'unified-workflow.js']) {
    assert.doesNotMatch(read(file), /api\.qrserver\.com|create-qr-code/i, file);
  }
  assert.match(read('index.html'), /src="\/qr-code\.js"/);
});

test('theme motion and notification sound honor reduced-motion preferences', () => {
  assert.match(read('product-enhancements.js'), /startViewTransition/);
  assert.match(read('friendly-controls.js'), /prefers-reduced-motion:\s*reduce/);
});

test('the development service worker cannot restore the pre-unified interface', () => {
  const worker = read('sw.js');
  for (const asset of ['supabase-browser.js', 'friendly-controls.js', 'unified-workflow.js', 'unified-workflow.css', 'qr-code.js']) {
    assert.match(worker, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(worker, /Accept:\s*'text\/css'/);
});

test('backend startup restores the account before showing login and never paints the legacy shell', () => {
  const app = read('app.js');
  const workflow = read('unified-workflow.js');
  assert.match(app, /if\s*\(!window\.BedehBackend\?\.configured\)\s*render\(\)/);
  assert.match(app, /if\s*\(!window\.BedehBackend\?\.configured\)\s*requestAnimationFrame\(render\)/);
  assert.match(workflow, /authReady/);
  assert.match(workflow, /در حال بازیابی حساب/);
  assert.ok(workflow.indexOf('if (!authReady)') < workflow.indexOf('if (!user)'));
});

test('expense copy treats the creator as payer and asks only for people who owe money', () => {
  const wizard = read('record-wizard-v2.js');
  const controls = read('friendly-controls.js');
  assert.match(wizard, /خودت پرداخت‌کننده‌ای/);
  assert.match(wizard, /چه کسانی باید دنگ بدهند/);
  assert.match(controls, /اسم خودت را اضافه نکن/);
});
