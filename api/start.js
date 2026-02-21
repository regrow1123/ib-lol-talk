// Vercel serverless: POST /api/start — V3 의도 기반 전투
import { createGame, fullState } from '../server/game.js';
import { assignPersonality } from '../server/ai.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { spells = ['flash', 'ignite'], rune = 'conqueror' } = req.body || {};
    const game = createGame(spells, rune);
    game.player.rune = rune;
    game.enemy.personality = assignPersonality();

    res.json({
      gameId: game.id,
      state: fullState(game),
      narrative: '⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. 리신 vs 리신 — 라인전 시작!',
      suggestions: [
        { skill: 'Q', text: 'Q1으로 상대 견제 — 미니언 사이로 빈틈 노리기' },
        { skill: 'Q', text: 'Q1 맞추고 Q2로 따라가서 짧은 교환' },
        { skill: 'W', text: 'W1 쉴드로 상대 공격 받아내면서 반격' },
        { skill: 'E', text: 'E1으로 근접 교환 시 추가 피해 노리기' },
        { skill: null, text: '미니언 뒤에서 안전하게 CS 챙기기' },
        { skill: null, text: '앞으로 걸어가서 레벨 1 압박 넣기' },
        { skill: null, text: '수풀에 숨어서 상대 움직임 관찰' },
      ],
    });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
}
