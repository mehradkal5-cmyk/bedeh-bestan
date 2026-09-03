(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BedehProductCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const div = (a, b) => Math.trunc(a / b);
  const mod = (a, b) => a - Math.trunc(a / b) * b;

  function jalCal(jy, withoutLeap) {
    const bl = breaks.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    let jm;
    let jump = 0;
    if (jy < jp || jy >= breaks[bl - 1]) throw new RangeError('سال شمسی خارج از محدوده است.');
    for (let i = 1; i < bl; i += 1) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    let n = jy - jp;
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (withoutLeap) return { gy, march };
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
  }

  function g2d(gy, gm, gd) {
    let day = div((gy + div(gm - 8, 6) + 100100) * 1461, 4);
    day += div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    day -= div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) - 752;
    return day;
  }

  function d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const day = div(mod(i, 153), 5) + 1;
    const month = mod(div(i, 153), 12) + 1;
    const year = div(j, 1461) - 100100 + div(8 - month, 6);
    return { year, month, day };
  }

  function j2d(year, month, day) {
    const calendar = jalCal(year, true);
    return g2d(calendar.gy, 3, calendar.march) + (month - 1) * 31 - div(month, 7) * (month - 7) + day - 1;
  }

  function d2j(jdn) {
    const gregorian = d2g(jdn);
    let year = gregorian.year - 621;
    let calendar = jalCal(year, false);
    const firstFarvardin = g2d(gregorian.year, 3, calendar.march);
    let offset = jdn - firstFarvardin;
    if (offset >= 0) {
      if (offset <= 185) return { year, month: 1 + div(offset, 31), day: mod(offset, 31) + 1 };
      offset -= 186;
    } else {
      year -= 1;
      offset += 179;
      if (calendar.leap === 1) offset += 1;
    }
    return { year, month: 7 + div(offset, 30), day: mod(offset, 30) + 1 };
  }

  const jalaliToGregorian = (year, month, day) => d2g(j2d(Number(year), Number(month), Number(day)));
  const gregorianToJalali = (year, month, day) => d2j(g2d(Number(year), Number(month), Number(day)));
  const isLeapJalaliYear = (year) => jalCal(Number(year), false).leap === 0;
  const jalaliMonthLength = (year, month) => month <= 6 ? 31 : month <= 11 ? 30 : isLeapJalaliYear(year) ? 30 : 29;
  const isValidJalaliDate = (year, month, day) => Number.isInteger(Number(year)) && Number.isInteger(Number(month)) && Number.isInteger(Number(day)) && month >= 1 && month <= 12 && day >= 1 && day <= jalaliMonthLength(year, month);
  const asciiDigits = (value) => String(value ?? '').replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  const isCompleted = (status) => ['completed', 'settled', 'returned'].includes(String(status));
  const formatPersianYear = (year) => String(Math.trunc(Number(year))).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  const signupState = (payload) => {
    const user = payload?.user || payload;
    return user?.id && payload?.access_token ? 'authenticated' : 'failed';
  };

  const tips = Object.freeze([
    'دنگتو امروز بده؛ فردا حافظهٔ جمعی خیلی خلاق می‌شه!',
    'قرض بی‌موعد مثل سریال بی‌قسمت آخره؛ همه کلافه می‌شن!',
    'رسید رو ثبت کن؛ اسکرین‌شات‌ها وقت نیاز غیبشون می‌زنه!',
    'امانت رو سالم پس بده؛ دستهٔ بازی خودش اعتراف نمی‌کنه!',
    'اگر موعد عوض شد خبر بده؛ غیب‌شدن جزو گزینه‌ها نیست!',
    'دنگ پیتزا رو یادت نره؛ تکهٔ آخرت در خطره!',
    'قسط کوچیک هم قسطه؛ با قیافهٔ معصوم حذف نمی‌شه!',
    'شماره کارت رو درست بزن؛ بانک اهل حدس‌زدن نیست!',
    'قرض رفاقتی خوبه؛ فقط تبدیل به فصل دوم دراما نشه!',
    'امانت مال مردمه؛ باهاش مثل مهمون ویژه رفتار کن!',
    'مانده رو چک کن؛ ماشین‌حساب رودربایستی نداره!',
    'دنگ گروهی رو زود جمع کن؛ گروه واتساپ دادگاه نیست!',
    'رسید داری؟ عالیه؛ کارآگاه‌بازی برای آخر شب نمی‌مونه!',
    'موعد فضایی نذار؛ یه تاریخی بزن که روی زمین شدنی باشه!',
    'لینک قدیمی رو ببند؛ مهمون ناخونده لازم نداریم!',
    'پرداخت نصفه رو هم ثبت کن؛ نصف پول هنوز پوله!',
    'بدهی با سین‌خوردن تسویه نمی‌شه؛ چت بانک نیست!',
    'امانت برگشت؟ ثبتش کن تا صاحبش خواب راحت ببینه!',
    'یادآوری محترمانه بفرست؛ طبل جنگ فعلاً لازم نیست!',
    'حساب‌وکتاب روشن باشه، رفاقت کمتر اخم می‌کنه!'
  ]);

  function passwordError(password) {
    const value = String(password ?? '');
    if (value.length < 8) return 'رمز عبور باید حداقل ۸ نویسه باشد.';
    if (!/\d/.test(value)) return 'رمز عبور باید دست‌کم یک عدد داشته باشد.';
    if (!/[A-Z]/.test(value)) return 'رمز عبور باید دست‌کم یک حرف بزرگ داشته باشد.';
    return '';
  }

  function receiptFileError(file) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!file || !allowed.has(file.type)) return 'فرمت رسید باید JPG، PNG، WebP یا PDF باشد.';
    if (Number(file.size) > 5 * 1024 * 1024) return 'حجم رسید نباید بیشتر از ۵ مگابایت باشد.';
    return '';
  }

  return { asciiDigits, formatPersianYear, signupState, gregorianToJalali, isCompleted, isLeapJalaliYear, isValidJalaliDate, jalaliMonthLength, jalaliToGregorian, passwordError, receiptFileError, tips };
}));
