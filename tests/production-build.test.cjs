const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
let output;
let html;
const runtimeFiles = [
  'runtime-config.js', 'product-core.js', 'backend-client.js', 'app.js',
  'record-wizard-v2.js', 'workflow-client.js', 'shared-workflow.js',
  'creator-inbox.js', 'ui-cleanup.js', 'product-enhancements.js', 'pwa-boot.js',
];

before(async () => {
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'bedeh-production-test-'));
  const { build } = await import('vite');
  await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true } });
  html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
});
after(async () => { if (output) await fs.rm(output, { recursive: true, force: true }); });

test('production preserves every ordered classic script and its browser syntax', async () => {
  const tags = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  assert.deepEqual(tags.map((tag) => new URL(tag[1], 'https://app.example/').pathname.slice(1)), runtimeFiles);
  for (const [i, tag] of tags.entries()) {
    assert.doesNotMatch(tag[0], /type="module"|\basync\b/);
    assert.equal(/\bdefer\b/.test(tag[0]), i > 0);
    const source = await fs.readFile(path.join(output, runtimeFiles[i]), 'utf8');
    new vm.Script(source, { filename: runtimeFiles[i] });
    if (runtimeFiles[i] !== 'runtime-config.js') {
      assert.equal(source, await fs.readFile(path.join(root, runtimeFiles[i]), 'utf8'));
    }
  }
});

test('every HTML asset exists, including root paths for nested SPA navigation', async () => {
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    assert.ok(match[1].startsWith('/'), `Not root-relative: ${match[1]}`);
    const file = new URL(match[1], 'https://app.example/').pathname.slice(1);
    assert.ok((await fs.stat(path.join(output, file))).isFile(), file);
  }
  for (const file of ['sw.js', 'offline.html', 'manifest.webmanifest', 'icon.svg']) {
    assert.ok((await fs.stat(path.join(output, file))).isFile(), file);
  }
});

test('production output contains only explicitly approved public runtime files', async () => {
  const allowed = [...runtimeFiles, 'index.html', 'sw.js', 'offline.html', 'manifest.webmanifest',
    'icon.svg', 'styles.css', 'backend-gate.css', 'ui-cleanup.css', 'record-wizard-v2.css',
    'layout-stability.css', 'product-enhancements.css', '_headers'];
  assert.deepEqual((await fs.readdir(output)).sort(), allowed.sort());
});

test('service worker precache references actual output and ignores private API traffic', async () => {
  const source = await fs.readFile(path.join(output, 'sw.js'), 'utf8');
  let assets;
  const handlers = {};
  vm.runInNewContext(source + '\n;globalThis.assetList = ASSETS;', {
    self: { location: { origin: 'https://app.example' }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    URL, get assetList() { return assets; }, set assetList(value) { assets = value; },
  });
  for (const url of assets) {
    const file = new URL(url, 'https://app.example/').pathname.slice(1) || 'index.html';
    assert.ok((await fs.stat(path.join(output, file))).isFile(), file);
  }
  assert.ok(!assets.some((url) => url.includes('runtime-config.js')));
  for (const url of ['https://other.example/rest/v1/records', 'https://app.example/private.json']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});
