// Vercel serverless: POST /api/turn
// Stateless — client sends full game state + input, server calls LLM + resolves
import { interpretTurn } from '../server/llm.js';
import { resolveTurn } from '../server/resolve.js';
import { fullState } from '../server/game.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, input } = req.body || {};
  if (!gameState || !input) {
    return res.status(400).json({ error: 'gameState와 input이 필요합니다' });
  }

  if (gameState.phase === 'gameover') {
    return res.json({
      state: gameState,
      narrative: '게임이 이미 종료되었습니다.',
      enemyAction: null,
    });
  }

  try {
    // LLM interprets player input + decides AI action
    const llmResult = await interpretTurn(gameState, input);

    // Server validates and applies exact damage/state changes
    const { dmgLog, state } = resolveTurn(gameState, llmResult);

    console.log(`Turn ${gameState.turn}: "${input}" → ${llmResult.playerAction.type} | AI=${llmResult.aiAction.type}`);

    res.json({
      state,
      narrative: llmResult.narrative,
      enemyAction: llmResult.aiChat,
      playerAction: llmResult.playerAction.detail,
      aiAction: llmResult.aiAction.detail,
    });
  } catch (err) {
    console.error('Turn error:', err.message);
    res.status(500).json({ error: '턴 처리 중 오류: ' + err.message });
  }
}
