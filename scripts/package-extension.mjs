import { mkdir, writeFile } from 'node:fs/promises';
import { zipExtension } from './extension-archive.mjs';

await mkdir('release', { recursive: true });
await writeFile('release/kontext-chrome.zip', await zipExtension());
console.log('release/kontext-chrome.zip');
