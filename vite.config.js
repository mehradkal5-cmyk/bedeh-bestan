import { defineConfig, loadEnv } from 'vite';
import { classicAssetsPlugin } from './scripts/classic-assets-plugin.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: '/',
    publicDir: false,
    plugins: [classicAssetsPlugin(env)],
  };
});
