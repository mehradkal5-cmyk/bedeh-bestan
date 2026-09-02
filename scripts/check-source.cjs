const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// index.html loads classic scripts, not ES modules. Parse the same way as the browser.
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^" ]*)?"[^>]*>/g)]
  .map((match) => match[1]).filter((file) => !/^https?:/.test(file));
for (const file of [...new Set([...scripts, 'sw.js'])]) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  console.log(`Syntax OK: ${file}`);
}
