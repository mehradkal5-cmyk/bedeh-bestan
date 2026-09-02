import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
createServer(async (req,res) => {
  const path = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0] === '/' ? 'index.html' : (req.url || '').split('?')[0])));
  if (!path.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  try { const body = await readFile(path); res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-cache'}); res.end(body); }
  catch { const body = await readFile(join(root,'index.html')); res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(body); }
}).listen(4173, '127.0.0.1', () => console.log('بده‌بستان: http://127.0.0.1:4173'));
