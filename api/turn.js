// Vercel serverless: POST /api/turn — V2
import { callLLM } from '../server/llm.js';
import { validateStateUpdate } from '../server/validate.js';
import { applyStateUpdate } from '../server/game.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, input, history } = req.body || {};
  if (!gameState || !input) {
    return res.status(400).json({ error: 'gameState와 input이 필요합니다' });
  }

  if (gameState.phase === 'gameover') {
    return res.json({ state: gameState, narrative: '게임이 이미 종료되었습니다.', aiChat: null, suggestions: [] });
  }

  try {
    // 1. LLM call
    const llmResult = await callLLM(gameState, input, history || []);

    // 2. Validate stateUpdate
    const validated = validateStateUpdate(llmResult.stateUpdate, gameState);

    // 3. Apply to state
    let nextState = applyStateUpdate(gameState, validated);

    // 4. Check gameOver
    let gameOver = llmResult.gameOver || null;
    if (validated.playerHp <= 0) {
      gameOver = { winner: 'enemy', reason: 'kill', summary: llmResult.gameOver?.summary || '적에게 처치당했습니다.' };
    } else if (validated.enemyHp <= 0) {
      gameOver = { winner: 'player', reason: 'kill', summary: llmResult.gameOver?.summary || '적을 처치했습니다!' };
    } else if (validated.playerCs >= 100) {
      gameOver = { winner: 'player', reason: 'cs', summary: 'CS 100 달성!' };
    } else if (validated.enemyCs >= 100) {
      gameOver = { winner: 'enemy', reason: 'cs', summary: '적이 먼저 CS 100에 도달했습니다.' };
    } else if (validated.towerHp.enemy <= 0) {
      gameOver = { winner: 'player', reason: 'tower', summary: '적 타워를 파괴했습니다!' };
    } else if (validated.towerHp.player <= 0) {
      gameOver = { winner: 'enemy', reason: 'tower', summary: '아군 타워가 파괴되었습니다.' };
    }

    if (gameOver) {
      nextState.phase = 'gameover';
      nextState.winner = gameOver.winner;
    }

    // 5. Check levelUp
    let levelUp = llmResult.levelUp || null;
    if (levelUp && levelUp.who !== 'enemy') {
      nextState.phase = 'skillup';
      nextState.player.skillPoints = (nextState.player.skillPoints || 0) + 1;
    }
    // Enemy auto level-up (AI picks skill)
    if (levelUp && (levelUp.who === 'enemy' || levelUp.who === 'both')) {
      nextState.enemy.skillPoints = 0; // AI already decided
    }

    console.log(`Turn ${gameState.turn}: "${input}" → HP ${validated.playerHp}/${validated.enemyHp}`);

    res.json({
      state: nextState,
      narrative: llmResult.narrative,
      aiChat: llmResult.aiChat,
      suggestions: llmResult.suggestions || [],
      levelUp,
      gameOver,
    });
  } catch (err) {
    console.error('Turn error:', err.message);
    res.status(500).json({ error: '턴 처리 중 오류: ' + err.message });
  }
}
