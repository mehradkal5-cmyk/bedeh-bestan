/* Public browser client. Only the Supabase URL and anon key are exposed here;
   privileged keys and card encryption remain inside Edge Functions. */
(function () {
  const injectedConfig = typeof __BEDEH_CONFIG__ === 'undefined' ? null : __BEDEH_CONFIG__;
  const config = injectedConfig || window.BEDEH_BESTAN_CONFIG || {};
  const base = String(config.supabaseUrl || '').replace(/\/$/, '');
  const anon = String(config.supabaseAnonKey || '');
  const authKey = 'bedeh-bestan.auth.access-token';
  const refreshKey = 'bedeh-bestan.auth.refresh-token';
  let sessionInFlight = null;
  let sessionRevision = 0;
  const configured = Boolean(base && anon && !base.includes('your-project'));
  const localizedError = (message) => ({
    'Invalid login credentials': 'ایمیل یا رمز عبور درست نیست.',
    'Email not confirmed': 'ورود این حساب هنوز فعال نشده است.',
    'User already registered': 'این ایمیل قبلاً ثبت شده است.',
    'Email address not authorized': 'ارسال ایمیل برای این نشانی مجاز نیست؛ تنظیمات SMTP پروژه باید بررسی شود.',
    'email rate limit exceeded': 'سقف ارسال ایمیل پر شده است؛ کمی بعد دوباره تلاش کنید.',
    'Password should be at least 6 characters.': 'رمز عبور باید حداقل ۸ نویسه باشد.',
  })[message] || message;

  const jsonHeaders = (token) => ({
    apikey: anon,
    Authorization: `Bearer ${token || anon}`,
    'Content-Type': 'application/json',
  });

  const response = async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(localizedError(body.msg || body.message || body.error_description || body.error || 'ارتباط با سرور ناموفق بود.'));
      error.status = res.status;
      error.code = body.code || body.error_code;
      throw error;
    }
    return body;
  };

  const storeSession = (payload) => {
    if (payload?.access_token) {
      sessionRevision += 1;
      sessionInFlight = null;
      sessionStorage.setItem(authKey, payload.access_token);
      if (payload.refresh_token) sessionStorage.setItem(refreshKey, payload.refresh_token);
      else sessionStorage.removeItem(refreshKey);
    }
    return payload;
  };

  const clearSession = () => {
    sessionRevision += 1;
    sessionInFlight = null;
    sessionStorage.removeItem(authKey);
    sessionStorage.removeItem(refreshKey);
    window.dispatchEvent(new Event('bedeh-signed-out'));
  };

  const tokenFromCallback = () => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (params.has('error') || params.has('error_code')) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      const error = new Error('لینک قدیمی ورود نامعتبر یا منقضی شده است.');
      error.code = 'confirmation_link_invalid';
      throw error;
    }
    const token = params.get('access_token');
    if (token) {
      storeSession({ access_token: token, refresh_token: params.get('refresh_token') });
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      return token;
    }
    return sessionStorage.getItem(authKey);
  };

  const requireConfig = () => {
    if (!configured) throw new Error('اتصال Supabase پیکربندی نشده است.');
  };
  const invoke = async (name, body, requiresSession = false) => {
    requireConfig();
    const user = requiresSession ? await window.BedehBackend.session() : null;
    if (requiresSession && !user?.access_token) throw new Error('برای این عملیات وارد حساب شوید.');
    return response(await fetch(`${base}/functions/v1/${name}`, {
      method: 'POST',
      headers: jsonHeaders(user?.access_token),
      body: JSON.stringify(body),
    }));
  };

  const normalizedEmail = (email) => {
    const value = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('ایمیل معتبر نیست.');
    return value;
  };

  async function readSession() {
    const token = tokenFromCallback();
    const refreshToken = sessionStorage.getItem(refreshKey);
    const revision = sessionRevision;
    if (!configured || (!token && !refreshToken)) return null;
    if (token) {
      try {
        const user = await response(await fetch(`${base}/auth/v1/user`, { headers: jsonHeaders(token) }));
        if (!user.id) throw new Error('پاسخ حساب کاربری معتبر نیست.');
        return revision === sessionRevision ? { ...user, access_token: token } : null;
      } catch (error) {
        // A network outage is not evidence that the user signed out.
        if (error.status !== 401 && error.status !== 403) throw error;
      }
    }
    if (revision !== sessionRevision) return null;
    if (!refreshToken) {
      clearSession();
      return null;
    }
    try {
      const refreshed = await response(await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ refresh_token: refreshToken }),
      }));
      if (revision !== sessionRevision) return null;
      if (!refreshed.user?.id || !refreshed.access_token || !refreshed.refresh_token) throw new Error('تمدید نشست کامل نشد؛ دوباره تلاش کنید.');
      storeSession(refreshed);
      return { ...refreshed.user, access_token: refreshed.access_token };
    } catch (error) {
      if (revision !== sessionRevision) return null;
      if ([400, 401, 403].includes(error.status)) {
        clearSession();
        return null;
      }
      throw error;
    }
  }

  window.BedehBackend = {
    configured,

    session() {
      if (!sessionInFlight) {
        // Share a single refresh: refresh tokens rotate and must not race.
        const operation = readSession().finally(() => {
          if (sessionInFlight === operation) sessionInFlight = null;
        });
        sessionInFlight = operation;
      }
      return sessionInFlight;
    },

    async signUp({ displayName, email, password }) {
      requireConfig();
      const body = await response(await fetch(`${base}/auth/v1/signup`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: normalizedEmail(email),
          password,
          data: { display_name: String(displayName || '').trim() },
        }),
      }));
      storeSession(body);
      return { ...body, user: body.user || (body.id ? body : null) };
    },

    async signIn({ email, password }) {
      requireConfig();
      const body = await response(await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ email: normalizedEmail(email), password }),
      }));
      storeSession(body);
      return body;
    },

    async signOut() {
      const token = sessionStorage.getItem(authKey);
      const deviceId = localStorage.getItem('bedeh-device-id');
      if (configured && token && deviceId) {
        try { await this.api('push-device', { action: 'disable', deviceId }); } catch { /* Local unsubscribe below also stops this browser's delivery. */ }
      }
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) await subscription.unsubscribe();
      } catch { /* Logout must still clear the authentication session offline. */ }
      clearSession();
      if (configured && token) await fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: jsonHeaders(token) });
    },

    async uploadReceipt(recordId, file) {
      requireConfig();
      const user = await this.session();
      if (!user?.id || !user.access_token) throw new Error('برای ثبت رسید وارد حساب شوید.');
      const validation = window.BedehProductCore?.receiptFileError(file);
      if (validation) throw new Error(validation);
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[file.type];
      const path = `${user.id}/${recordId}/${crypto.randomUUID()}.${extension}`;
      const upload = await fetch(`${base}/storage/v1/object/receipts/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${user.access_token}`,
          'Content-Type': file.type,
          'x-upsert': 'false',
        },
        body: file,
      });
      if (!upload.ok) {
        const error = await upload.json().catch(() => ({}));
        throw new Error(error.message || error.error || 'بارگذاری رسید انجام نشد.');
      }
      return { path, name: file.name.slice(0, 180), mime: file.type };
    },

    async command(action, payload) {
      const result = await invoke('record-command', { action, payload: payload || {} }, true);
      if (!result.ok) throw new Error(result.error || 'درخواست انجام نشد.');
      return result.data;
    },

    async api(name, payload) {
      const result = await invoke(name, payload || {}, true);
      if (!result.ok) throw new Error(result.error || 'درخواست انجام نشد.');
      return result.data;
    },

    realtimeClient() {
      requireConfig();
      if (!window.supabase) throw new Error('اتصال زنده بارگذاری نشد.');
      return window.supabase.createClient(base, anon, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        accessToken: async () => (await this.session())?.access_token || null,
      });
    },

    async shared(token) {
      const result = await invoke('shared-record', { token });
      if (!result.ok) {
        const error = new Error(result.error || 'لینک در دسترس نیست.');
        error.code = result.code;
        throw error;
      }
      return result.data;
    },

    async recipient(token, action, payload) {
      const result = await invoke('recipient-action', { token, action, payload: payload || {} }, true);
      if (!result.ok) throw new Error(result.error || 'درخواست انجام نشد.');
      return result.data;
    },
  };

  window.dispatchEvent(new Event('bedeh-backend-ready'));
}());
