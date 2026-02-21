// POST /api/skillup — Skill level up (validation only, no LLM)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, skill } = req.body || {};
  if (!gameState || !skill) return res.status(400).json({ error: 'gameState와 skill이 필요합니다' });

  const valid = ['Q', 'W', 'E', 'R'];
  if (!valid.includes(skill)) return res.status(400).json({ error: '잘못된 스킬입니다' });

  const state = JSON.parse(JSON.stringify(gameState));
  const p = state.player;

  if (p.skillPoints <= 0) return res.status(400).json({ error: '스킬포인트가 없습니다' });

  const maxRank = skill === 'R' ? 3 : 5;
  if (p.skillLevels[skill] >= maxRank) return res.status(400).json({ error: '이미 최대 레벨입니다' });

  if (skill === 'R' && ![6, 11, 16].includes(p.level)) {
    return res.status(400).json({ error: 'R은 레벨 6/11/16에서만 배울 수 있습니다' });
  }

  p.skillLevels[skill]++;
  p.skillPoints--;

  if (p.skillPoints <= 0) {
    state.phase = 'play';
  }

  res.json({ ok: true, state });
}
