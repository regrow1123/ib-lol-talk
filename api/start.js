// Vercel serverless: POST /api/start — V2
import { createGame, fullState } from '../server/game.js';

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

    res.json({
      gameId: game.id,
      state: fullState(game),
      narrative: '⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. 리신 vs 리신 — 라인전 시작!',
      suggestions: ['미니언 뒤에서 안전하게 CS 챙기기', 'Q로 찔러보고 맞으면 따라간다', '앞으로 걸어가서 압박 넣기'],
    });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
}
