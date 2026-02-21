// POST /api/start — Game initialization
import { createGameState } from '../server/game.js';
import { loadChampion } from '../server/champions.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { champion = 'lee-sin', spells = ['flash', 'ignite'], rune = 'conqueror' } = req.body || {};
    const state = createGameState(champion, spells, rune);
    const champ = loadChampion(champion);

    // Build initial suggestions with skill tags
    const suggestions = buildInitialSuggestions(champ);

    res.json({
      state,
      narrative: `⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. ${champ.name} vs ${champ.name} — 라인전 시작!`,
      suggestions,
    });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
}

function buildInitialSuggestions(champ) {
  const suggestions = [];

  for (const [key, skill] of Object.entries(champ.skills)) {
    if (key === 'R') continue; // R not available at start
    const name = skill.name[0];
    suggestions.push({
      skill: key,
      text: `${key}1(${name})으로 상대 견제해보기`,
    });
  }

  suggestions.push(
    { skill: null, text: '미니언 뒤에서 안전하게 CS 챙기기' },
    { skill: null, text: '앞으로 걸어가서 레벨 1 압박' },
    { skill: null, text: '상대 움직임 관찰하면서 대기' },
  );

  return suggestions;
}
