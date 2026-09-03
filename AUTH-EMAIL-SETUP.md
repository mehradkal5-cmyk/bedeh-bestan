# تنظیم ورود مستقیم

بده‌بستان از Supabase Auth با ایمیل و رمز عبور استفاده می‌کند. رابط برنامه کد یک‌بارمصرف، Magic Link یا ارسال دوبارهٔ ایمیل تأیید ندارد و فقط نشست واقعی Supabase را معتبر می‌داند.

## تنظیم لازم در Supabase

1. در Authentication → Sign In / Providers → Email، ورود با ایمیل و رمز عبور را روشن نگه دارید.
2. گزینهٔ `Confirm email` را خاموش کنید. معادل محلی آن در `supabase/config.toml` مقدار `enable_confirmations = false` است.
3. RLS، اعتبارسنجی JWT و کلیدهای server-side را تغییر ندهید.

خاموش‌کردن `Confirm email` یعنی مالکیت صندوق ایمیل اثبات نمی‌شود. برنامه برای ثبت‌نام موفق حتماً `access_token` واقعی می‌خواهد و اگر Supabase فقط کاربر بدون نشست برگرداند، ثبت‌نام را ناموفق نشان می‌دهد؛ نشست جعلی ساخته نمی‌شود.

کلید `service_role`، رمز پایگاه داده، `CARD_ENCRYPTION_KEY` و `REMINDER_CRON_SECRET` نباید در فرانت‌اند یا `runtime-config.js` قرار بگیرند.
