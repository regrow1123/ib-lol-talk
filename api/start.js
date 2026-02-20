// Vercel serverless: POST /api/start
import { createGame, clientState } from '../server/game.js';

// In-memory store (per instance — fine for prototype)
// Shared across functions via global
if (!globalThis.__games) globalThis.__games = new Map();

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

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
}
