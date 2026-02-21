// Champion data loader
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = {};

export function loadChampion(id) {
  if (cache[id]) return cache[id];
  const path = join(__dirname, '..', 'data', 'champions', `${id}.json`);
  cache[id] = JSON.parse(readFileSync(path, 'utf8'));
  return cache[id];
}
