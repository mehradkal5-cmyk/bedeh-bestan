const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^" ]*)?"[^>]*>/g)]
  .filter((match) => !/^https?:/.test(match[1]));
for (const [file, module] of [...new Map([...tags.map((match) => [match[1], /\btype="module"/.test(match[0])]), ['sw.js', false]])]) {
  const sourcePath = path.join(root, file);
  if (module) {
    const checked = spawnSync(process.execPath, ['--check', sourcePath], { encoding: 'utf8' });
    if (checked.status !== 0) throw new Error(checked.stderr || `Invalid module: ${file}`);
  } else new vm.Script(fs.readFileSync(sourcePath, 'utf8'), { filename: file });
  console.log(`Syntax OK: ${file}`);
}
