import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    define: {
      __BEDEH_CONFIG__: JSON.stringify({
        supabaseUrl: env.VITE_SUPABASE_URL || '',
        supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
      }),
    },
  };
});
