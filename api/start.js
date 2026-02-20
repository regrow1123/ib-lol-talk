// Vercel serverless: POST /api/start
// Stateless — just returns initial game state
import { createGame, fullState } from '../server/game.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { difficulty = 'normal' } = req.body || {};
    const game = createGame(difficulty);

    res.json({
      gameId: game.id,
      state: fullState(game),
      difficulty,
      narrative: '⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. 리신 vs 리신 — 라인전 시작!',
    });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
}
