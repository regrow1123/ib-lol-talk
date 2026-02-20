// Vercel serverless: POST /api/turn
import { clientState } from '../server/game.js';
import { interpretTurn } from '../server/llm.js';
import { resolveTurn } from '../server/resolve.js';

if (!globalThis.__games) globalThis.__games = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { gameId, input } = req.body || {};
  if (!gameId || !input) {
    return res.status(400).json({ error: 'gameId와 input이 필요합니다' });
  }

  const game = globalThis.__games.get(gameId);
  if (!game) {
    return res.status(404).json({ error: '게임을 찾을 수 없습니다. 새 게임을 시작하세요.' });
  }

  if (game.phase === 'gameover') {
    return res.json({
      state: clientState(game),
      narrative: '게임이 이미 종료되었습니다.',
      enemyAction: null,
    });
  }

  try {
    const llmResult = await interpretTurn(game, input);
    const { dmgLog, state } = resolveTurn(game, llmResult);

    console.log(`[${gameId.slice(0,8)}] Turn ${game.turn}: "${input}" → ${llmResult.playerAction.type} | AI=${llmResult.aiAction.type}`);

    res.json({
      state,
      narrative: llmResult.narrative,
      enemyAction: llmResult.aiChat,
      playerAction: llmResult.playerAction.detail,
      aiAction: llmResult.aiAction.detail,
    });
  } catch (err) {
    console.error(`[${gameId.slice(0,8)}] Error:`, err.message);
    res.status(500).json({ error: '턴 처리 중 오류가 발생했습니다: ' + err.message });
  }
}
