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
    // 0. Pre-validate: check if input references unavailable skills
    const blocked = checkSkillAvailability(gameState.player, input);
    if (blocked) {
      return res.json({
        state: gameState,
        narrative: blocked,
        aiChat: null,
        suggestions: [],
      });
    }

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

// Pre-check: does the input reference a skill that's unavailable?
function checkSkillAvailability(player, input) {
  const text = input.toUpperCase();
  const SKILL_KEYWORDS = {
    Q: ['Q', 'Q1', 'Q2', '음파', '공명타'],
    W: ['W', 'W1', 'W2', '방호', '철갑', '쉴드'],
    E: ['E', 'E1', 'E2', '폭풍', '쇠약'],
    R: ['R', '궁', '궁극기', '용의분노', '킥'],
  };

  for (const [key, keywords] of Object.entries(SKILL_KEYWORDS)) {
    const matched = keywords.some(kw => text.includes(kw.toUpperCase()));
    if (!matched) continue;

    const lv = player.skillLevels?.[key] || 0;
    const cd = player.cooldowns?.[key] || 0;
    const cost = key === 'R' ? 0 : 50;
    const name = {Q:'음파',W:'방호',E:'폭풍',R:'용의 분노'}[key];

    if (lv === 0) return `⚠️ ${key} (${name}) — 아직 배우지 않은 스킬입니다!`;
    if (cd > 0) return `⚠️ ${key} (${name}) — 쿨타임 중입니다! (${cd}턴 남음)`;
    if (cost > (player.energy || 0)) return `⚠️ ${key} (${name}) — 기력이 부족합니다! (${cost} 필요, 현재 ${player.energy})`;
  }
  return null;
}
