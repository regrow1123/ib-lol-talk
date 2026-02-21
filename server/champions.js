// Champion data loader — reads from data/champions/{id}.json
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = {};

export function loadChampion(id) {
  if (cache[id]) return cache[id];
  const filePath = join(__dirname, '..', 'data', 'champions', `${id}.json`);
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  cache[id] = data;
  return data;
}
