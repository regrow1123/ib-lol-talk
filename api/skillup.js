// Vercel serverless: POST /api/skillup
import { clientState } from '../server/game.js';

if (!globalThis.__games) globalThis.__games = new Map();

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { gameId, skill } = req.body || {};
  const game = globalThis.__games.get(gameId);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다' });

  const p = game.player;
  if (p.skillPoints <= 0) return res.status(400).json({ error: '스킬 포인트가 없습니다' });

  const valid = ['Q', 'W', 'E', 'R'];
  if (!valid.includes(skill)) return res.status(400).json({ error: '잘못된 스킬입니다' });

  const maxRank = skill === 'R' ? 3 : 5;
  if (p.skillLevels[skill] >= maxRank) return res.status(400).json({ error: '이미 최대 레벨입니다' });
  if (skill === 'R' && ![6, 11, 16].includes(p.level)) return res.status(400).json({ error: 'R은 6/11/16 레벨에만' });

  p.skillLevels[skill]++;
  p.skillPoints--;
  if (p.level >= 6 && p.cooldowns.R === 99) p.cooldowns.R = 0;
  if (p.skillPoints <= 0) game.phase = 'play';

  res.json({
    state: clientState(game),
    skill,
    newRank: p.skillLevels[skill],
  });
}
