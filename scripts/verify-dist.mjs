import { fileURLToPath } from 'node:url';
import { verifyDist } from './production-assets.mjs';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const result = await verifyDist(directory);
console.log(`Verified ${result.files.length} allowlisted files and ${result.references} references in dist.`);
console.log(result.files.join('\n'));
