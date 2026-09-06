import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// This is the entire publish boundary. Never glob the repository or use it as publicDir.
export const runtimeFiles = Object.freeze([
  'runtime-config.js', 'supabase-browser.js', 'unified-workflow.js', 'unified-workflow.css', 'product-core.js', 'backend-client.js', 'app.js',
  'record-wizard-v2.js', 'workflow-client.js', 'shared-workflow.js',
  'creator-inbox.js', 'ui-cleanup.js', 'product-enhancements.js', 'pwa-boot.js',
  'styles.css', 'backend-gate.css', 'ui-cleanup.css', 'record-wizard-v2.css',
  'layout-stability.css', 'product-enhancements.css', 'manifest.webmanifest',
  'icon.svg', 'offline.html', 'sw.js',
]);
export const outputFiles = Object.freeze(['index.html', ...runtimeFiles, '_headers']);

export function localPath(reference, from = 'index.html') {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  const url = new URL(reference, `https://build.invalid/${from}`);
  return decodeURIComponent(url.pathname).slice(1) || 'index.html';
}

export function assertPublicSource(source, file) {
  const forbidden = /SUPABASE_SERVICE_ROLE_KEY|CARD_ENCRYPTION_KEY|REMINDER_CRON_SECRET|SUPABASE_DB_PASSWORD|sb_secret_[\w-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/;
  if (forbidden.test(source)) throw new Error(`Server-only credential marker in public asset: ${file}`);
  for (const [token] of source.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    let payload;
    try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { continue; }
    if (payload.role !== 'anon') throw new Error(`Non-anon JWT in public asset: ${file}`);
  }
}

export async function readPublicFile(root, file) {
  if (!runtimeFiles.includes(file) && file !== 'index.html') throw new Error(`Asset is not allowlisted: ${file}`);
  const resolvedRoot = await fs.realpath(root);
  const resolvedFile = await fs.realpath(path.join(root, file));
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset escapes project: ${file}`);
  const source = await fs.readFile(resolvedFile, 'utf8');
  assertPublicSource(source, file);
  return source;
}

export function publicConfigSource(source, env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url && !key) return source;
  if (!url || !key) throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.');
  if (new URL(url).protocol !== 'https:') throw new Error('Production Supabase URL must use HTTPS.');
  if (!key.startsWith('sb_publishable_')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* rejected below */ }
    if (role !== 'anon') throw new Error('Only an anon or publishable Supabase browser key is allowed.');
  }
  const result = `// Public Supabase browser configuration; no server secrets.\nwindow.BEDEH_BESTAN_CONFIG = Object.freeze(${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key })});\n`;
  assertPublicSource(result, 'runtime-config.js');
  return result;
}

export async function verifyDist(directory) {
  const actual = await fs.readdir(directory);
  const extra = actual.filter((file) => !outputFiles.includes(file));
  const missing = outputFiles.filter((file) => !actual.includes(file));
  if (extra.length || missing.length) throw new Error(`Invalid dist contents. Extra: ${extra.join(', ')}; missing: ${missing.join(', ')}`);
  const sources = new Map();
  for (const file of outputFiles) {
    const stat = await fs.lstat(path.join(directory, file));
    if (!stat.isFile()) throw new Error(`Not a regular public file: ${file}`);
    const source = await fs.readFile(path.join(directory, file), 'utf8');
    assertPublicSource(source, file);
    if (file.endsWith('.js')) new vm.Script(source, { filename: file });
    sources.set(file, source);
  }
  const references = [];
  for (const [file, source] of sources) {
    if (file.endsWith('.html')) {
      for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) references.push([file, match[1]]);
    }
    if (file.endsWith('.css')) {
      for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/g)) references.push([file, match[1] || match[2]]);
    }
    if (file.endsWith('.js')) {
      for (const match of source.matchAll(/(?:\.register|importScripts|import|fetch)\(\s*["']([^"']+)["']/g)) references.push([file, match[1]]);
    }
  }
  const manifest = JSON.parse(sources.get('manifest.webmanifest'));
  for (const icon of manifest.icons || []) references.push(['manifest.webmanifest', icon.src]);
  references.push(['manifest.webmanifest', manifest.start_url]);
  const context = { self: { addEventListener() {} }, URL };
  vm.runInNewContext(`${sources.get('sw.js')}\n;this.precache = ASSETS;`, context);
  for (const asset of context.precache) references.push(['sw.js', asset]);
  for (const [from, reference] of references) {
    const file = localPath(reference, from);
    if (file && !sources.has(file)) throw new Error(`Missing production reference: ${from} -> ${reference}`);
  }
  return { files: actual.sort(), references: references.length };
}
