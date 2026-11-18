import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

async function collect(directory, base = '') {
  const result = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const item of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const key = base + item.name;
    if (item.isDirectory()) Object.assign(result, await collect(join(directory, item.name), `${key}/`));
    else if (item.isFile()) result[key] = await readFile(join(directory, item.name));
  }
  return result;
}

export async function zipExtension() {
  return zipSync(await collect(fileURLToPath(new URL('../extension/', import.meta.url))), { mtime: new Date(2020, 0, 1) });
}
