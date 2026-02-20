// Vercel serverless: POST /api/start
import { createGame, clientState } from '../server/game.js';
import { randomUUID } from 'crypto';

// In-memory store (per instance — fine for prototype)
if (!globalThis.__games) globalThis.__games = new Map();

export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { difficulty = 'normal' } = req.body || {};
    const game = createGame(difficulty);
    globalThis.__games.set(game.id, game);

    // Clean old games (keep max 100)
    if (globalThis.__games.size > 100) {
      const oldest = globalThis.__games.keys().next().value;
      globalThis.__games.delete(oldest);
    }

    res.json({
      gameId: game.id,
      state: clientState(game),
      narrative: '⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. 리신 vs 리신 — 라인전 시작!',
    });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
}
