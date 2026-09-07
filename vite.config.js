import { defineConfig, loadEnv } from 'vite';
import { classicAssetsPlugin } from './scripts/classic-assets-plugin.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: '/',
    publicDir: false,
    plugins: [classicAssetsPlugin(env)],
    build: { rollupOptions: { output: { entryFileNames: (chunk) => chunk.name === 'index' ? 'qr-code.js' : '[name].js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' } } },
  };
});
