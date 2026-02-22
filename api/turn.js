// POST /api/turn — Turn processing: LLM → damage engine → state update
import { callLLM } from '../server/llm.js';
import { applyActions } from '../server/damage.js';
import { validateState } from '../server/validate.js';
import { csToLevel, recalcStats } from '../server/game.js';

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
    return res.json({ state: gameState, narrative: '게임이 이미 종료되었습니다.', suggestions: [] });
  }

  try {
    // 1. LLM call
    const llmResult = await callLLM(gameState, input, history || []);

    // 2. Deep copy state for mutation
    const state = JSON.parse(JSON.stringify(gameState));

    // 3. Damage engine: apply actions
    applyActions(state, llmResult);

    // 4. Guardrail validation
    validateState(state);

    // 5. Level up check (player)
    let levelUp = null;
    const expectedPlayerLevel = csToLevel(state.player.cs);
    if (expectedPlayerLevel > gameState.player.level) {
      const gained = expectedPlayerLevel - gameState.player.level;
      state.player.level = expectedPlayerLevel;
      state.player.skillPoints = (state.player.skillPoints || 0) + gained;
      recalcStats(state.player, state.player.champion);
      // Heal proportionally to max HP increase
      const hpRatio = gameState.player.hp / gameState.player.maxHp;
      state.player.hp = Math.round(hpRatio * state.player.maxHp);
      state.phase = 'skillup';
      levelUp = { newLevel: expectedPlayerLevel, who: 'player' };
    }

    // 6. Level up check (enemy) — LLM chooses skill
    const expectedEnemyLevel = csToLevel(state.enemy.cs);
    if (expectedEnemyLevel > gameState.enemy.level) {
      state.enemy.level = expectedEnemyLevel;
      recalcStats(state.enemy, state.enemy.champion);
      const hpRatio = gameState.enemy.hp / gameState.enemy.maxHp;
      state.enemy.hp = Math.round(hpRatio * state.enemy.maxHp);

      // LLM-chosen skill up
      if (llmResult.enemySkillUp) {
        const key = llmResult.enemySkillUp;
        if (isValidSkillUp(state.enemy, key)) {
          state.enemy.skillLevels[key]++;
        }
      } else {
        // Fallback: auto skill up
        autoSkillUp(state.enemy);
      }
    }

    // 6.5. Enemy pending skillPoints (e.g. initial skill at game start)
    if (state.enemy.skillPoints > 0 && llmResult.enemySkillUp) {
      const key = llmResult.enemySkillUp;
      if (isValidSkillUp(state.enemy, key)) {
        state.enemy.skillLevels[key]++;
        state.enemy.skillPoints--;
      }
    }

    // 7. Game over check
    let gameOver = llmResult.gameOver || null;
    if (!gameOver) {
      if (state.player.hp <= 0 && state.enemy.hp <= 0) {
        state.player.hp = 1;
        state.enemy.hp = 0;
        gameOver = { winner: 'player', reason: 'kill', summary: '아슬아슬하게 먼저 처치!' };
      } else if (state.player.hp <= 0) {
        gameOver = { winner: 'enemy', reason: 'kill', summary: '적에게 처치당했습니다.' };
      } else if (state.enemy.hp <= 0) {
        gameOver = { winner: 'player', reason: 'kill', summary: '적을 처치했습니다!' };
      } else if (state.player.cs >= 50) {
        gameOver = { winner: 'player', reason: 'cs', summary: 'CS 50 달성!' };
      } else if (state.enemy.cs >= 50) {
        gameOver = { winner: 'enemy', reason: 'cs', summary: '적이 먼저 CS 50에 도달.' };
      }
    }

    if (gameOver) {
      state.phase = 'gameover';
      state.winner = gameOver.winner;
    } else if (!levelUp) {
      state.phase = 'play';
    }

    console.log(`Turn ${gameState.turn}: "${input}" → HP ${state.player.hp}/${state.enemy.hp} CS ${state.player.cs}/${state.enemy.cs}`);

    res.json({
      state,
      narrative: llmResult.narrative || '',
      aiChat: llmResult.aiChat || null,
      suggestions: llmResult.suggestions || [],
      levelUp,
      gameOver,
    });
  } catch (err) {
    console.error('Turn error:', err.message, err.stack);
    res.status(500).json({ error: '턴 처리 중 오류: ' + err.message });
  }
}

function isValidSkillUp(enemy, key) {
  if (!['Q', 'W', 'E', 'R'].includes(key)) return false;
  const maxRank = key === 'R' ? 3 : 5;
  if (enemy.skillLevels[key] >= maxRank) return false;
  if (key === 'R' && ![6, 11, 16].includes(enemy.level)) return false;
  return true;
}

function autoSkillUp(enemy) {
  if (enemy.level >= 6 && enemy.skillLevels.R < 1) { enemy.skillLevels.R++; return; }
  if (enemy.level >= 11 && enemy.skillLevels.R < 2) { enemy.skillLevels.R++; return; }
  if (enemy.level >= 16 && enemy.skillLevels.R < 3) { enemy.skillLevels.R++; return; }
  for (const sk of ['Q', 'E', 'W']) {
    if (enemy.skillLevels[sk] < 5) { enemy.skillLevels[sk]++; return; }
  }
}
