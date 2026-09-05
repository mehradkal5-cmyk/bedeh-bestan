(() => {
  const config = () => {
    const candidates = [
      window.BEDEH_BESTAN_CONFIG,
      window.__RUNTIME_CONFIG__,
      window.RUNTIME_CONFIG,
      window.__BEDEH_RUNTIME_CONFIG__,
      window.BEDEH_RUNTIME_CONFIG,
      window.runtimeConfig,
      window.BedehRuntimeConfig,
    ].filter((candidate) => candidate && typeof candidate === 'object');

    for (const candidate of candidates) {
      const supabaseUrl = candidate.supabaseUrl || candidate.SUPABASE_URL || candidate.url;
      const supabaseAnonKey = candidate.supabaseAnonKey || candidate.SUPABASE_ANON_KEY || candidate.anonKey;
      if (typeof supabaseUrl === 'string' && typeof supabaseAnonKey === 'string') {
        return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseAnonKey };
      }
    }
    throw new Error('پیکربندی اتصال سرویس در دسترس نیست.');
  };

  const sessionToken = async () => {
    const session = await window.BedehBackend?.session?.();
    return session?.access_token || null;
  };

  const invoke = async (name, payload, requireSession = false) => {
    const { supabaseUrl, supabaseAnonKey } = config();
    const token = requireSession ? await sessionToken() : null;
    if (requireSession && !token) throw new Error('برای این عملیات وارد شوید.');

    let response;
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error('اتصال برقرار نشد. دوباره تلاش کنید.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || 'عملیات انجام نشد.');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data.data;
  };

  window.BedehWorkflow = Object.freeze({
    shared: (token) => window.BedehBackend.shared(token),
    recipient: (token, action, payload = {}) => window.BedehBackend.recipient(token, action, payload),
    creator: (action, payload = {}) => invoke('creator-action', { action, ...payload }, true),
    command: (action, payload = {}) => window.BedehBackend.command(action, payload),
  });
})();
