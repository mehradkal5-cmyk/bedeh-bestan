const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(require.resolve('../product-core.js'), 'utf8'), sandbox);
const core = sandbox.BedehProductCore;

test('converts Nowruz 1403 to its Gregorian date', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.jalaliToGregorian(1403, 1, 1))), { year: 2024, month: 3, day: 20 });
});

test('converts a Gregorian date back to Jalali', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.gregorianToJalali(2025, 3, 20))), { year: 1403, month: 12, day: 30 });
});

test('rejects an impossible Jalali date', () => {
  assert.equal(core.isValidJalaliDate(1403, 12, 30), true);
  assert.equal(core.isValidJalaliDate(1402, 12, 30), false);
});

test('normalizes Persian and Arabic digits', () => {
  assert.equal(core.asciiDigits('۱۴۰۳/٠٩/۲۱'), '1403/09/21');
});

test('exposes exactly twenty concise conversational tips', () => {
  assert.equal(core.tips.length, 20);
  assert.equal(new Set(core.tips).size, 20);
  assert.ok(core.tips.every((tip) => tip.length >= 12 && tip.length <= 80));
  assert.ok(core.tips.filter((tip) => /!|😂|😅|شوخی|قهر|غیب|سریال|کارآگاه|دراما|چیپس|پیتزا|فضایی/.test(tip)).length >= 15);
});

test('formats Jalali years without thousands separators', () => {
  assert.equal(core.formatPersianYear(1405), '۱۴۰۵');
  assert.doesNotMatch(core.formatPersianYear(1405), /[,٬]/);
});

test('distinguishes a pending confirmation from an authenticated signup', () => {
  assert.equal(core.signupState({ user: { id: 'u1' } }), 'pending');
  assert.equal(core.signupState({ id: 'u1' }), 'pending');
  assert.equal(core.signupState({ user: { id: 'u1' }, access_token: 'token' }), 'authenticated');
  assert.equal(core.signupState({}), 'failed');
});

test('recognizes every completed record status', () => {
  for (const status of ['completed', 'settled', 'returned']) assert.equal(core.isCompleted(status), true);
  assert.equal(core.isCompleted('open'), false);
});

test('requires a strong account password', () => {
  assert.equal(core.passwordError('1234567'), 'رمز عبور باید حداقل ۸ نویسه باشد.');
  assert.equal(core.passwordError('abcdefgh'), 'رمز عبور باید دست‌کم یک عدد داشته باشد.');
  assert.equal(core.passwordError('abc12345'), 'رمز عبور باید دست‌کم یک حرف بزرگ داشته باشد.');
  assert.equal(core.passwordError('Abc12345'), '');
});

test('accepts only safe receipt files up to five megabytes', () => {
  assert.equal(core.receiptFileError({ type: 'image/jpeg', size: 1024 }), '');
  assert.equal(core.receiptFileError({ type: 'application/pdf', size: 1024 }), '');
  assert.equal(core.receiptFileError({ type: 'text/html', size: 1024 }), 'فرمت رسید باید JPG، PNG، WebP یا PDF باشد.');
  assert.equal(core.receiptFileError({ type: 'image/png', size: 6 * 1024 * 1024 }), 'حجم رسید نباید بیشتر از ۵ مگابایت باشد.');
});
