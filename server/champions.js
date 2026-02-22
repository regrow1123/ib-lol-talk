import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const cache = {};

export function loadChampion(id) {
  if (cache[id]) return cache[id];
  const data = require(`../data/champions/${id}.json`);
  cache[id] = data;
  return data;
}
