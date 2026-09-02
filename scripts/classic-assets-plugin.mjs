import { createHash } from 'node:crypto';
import path from 'node:path';
import { localPath, publicConfigSource, readPublicFile, runtimeFiles, verifyDist } from './production-assets.mjs';

// Vite normally leaves classic script URLs untouched without emitting their files.
// Hide only allowlisted local tags from HTML bundling, then restore them in place.
// This preserves parser-blocking runtime config, defer order and shared globals.
export function classicAssetsPlugin(env = {}) {
  let config;
  let sources;
  let version;
  let tags;
  const assetUrl = (file) => `/${file}${/\.(?:js|css)$/.test(file) ? `?v=${version}` : ''}`;
  return {
    name: 'bedeh-explicit-classic-assets',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async buildStart() {
      tags = [];
      sources = new Map(await Promise.all(runtimeFiles.map(async (file) => [file, await readPublicFile(config.root, file)])));
      sources.set('runtime-config.js', publicConfigSource(sources.get('runtime-config.js'), env));
      const hash = createHash('sha256').update(await readPublicFile(config.root, 'index.html'));
      for (const [file, source] of sources) hash.update(file).update(source);
      version = hash.digest('hex').slice(0, 16);
      const precache = ['/', '/index.html', ...runtimeFiles.filter((file) => !['runtime-config.js', 'sw.js'].includes(file)).map(assetUrl)];
      const worker = sources.get('sw.js')
        .replace(/^const CACHE = .*;$/m, `const CACHE = 'bedeh-bestan-${version}';`)
        .replace(/^const ASSETS = .*;$/m, `const ASSETS = ${JSON.stringify(precache)};`);
      sources.set('sw.js', worker);
      for (const [fileName, source] of sources) this.emitFile({ type: 'asset', fileName, source });
      this.emitFile({ type: 'asset', fileName: '_headers', source:
        '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n/runtime-config.js\n  Cache-Control: no-store\n/sw.js\n  Cache-Control: no-cache\n' });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>|<link\b[^>]*\bhref=["'][^"']+["'][^>]*>/gi, (tag) => {
          const reference = tag.match(/\b(?:src|href)=["']([^"']+)["']/)[1];
          const file = localPath(reference);
          if (!file) return tag;
          if (!sources.has(file)) throw new Error(`HTML asset is not allowlisted: ${reference}`);
          const marker = `<!--bedeh-public-asset-${tags.length}-->`;
          tags.push(tag.replace(reference, assetUrl(file)));
          return marker;
        });
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const entry = bundle['index.html'];
        if (!entry || entry.type !== 'asset') throw new Error('Missing Vite HTML output.');
        entry.source = String(entry.source).replace(/<!--bedeh-public-asset-(\d+)-->/g, (_, index) => tags[Number(index)]);
      },
    },
    async writeBundle() {
      const result = await verifyDist(path.resolve(config.root, config.build.outDir));
      config.logger.info(`Verified ${result.files.length} public files and ${result.references} runtime references.`);
    },
  };
}
