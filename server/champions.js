import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = {};

export function loadChampion(id) {
  if (cache[id]) return cache[id];

  // Try multiple paths for Vercel compatibility
  const paths = [
    join(__dirname, '..', 'data', 'champions', `${id}.json`),
    join(process.cwd(), 'data', 'champions', `${id}.json`),
  ];

  let data = null;
  for (const p of paths) {
    try {
      data = JSON.parse(readFileSync(p, 'utf-8'));
      break;
    } catch {}
  }

  if (!data) {
    throw new Error(`Champion data not found: ${id}`);
  }

  cache[id] = data;
  return data;
}
