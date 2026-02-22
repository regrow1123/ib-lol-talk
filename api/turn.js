import { callLLM } from '../server/llm.js';
import { applyActions } from '../server/damage.js';
import { validateState } from '../server/validate.js';
import { csToLevel, recalcStats } from '../server/game.js';
import { loadChampion } from '../server/champions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameState, input, history } = req.body || {};
  if (!gameState || !input) {
    return res.status(400).json({ error: 'Missing gameState or input' });
  }

  try {
    // Check if level-up is likely (within 3 CS of next level)
    const levelUpHint = isLevelUpClose(gameState.player.cs, gameState.player.level);

    // 1. Call LLM
    const llmResult = await callLLM(gameState, input, history || [], { levelUpHint });

    // 2. Deep copy state
    const state = JSON.parse(JSON.stringify(gameState));

    // 3. Apply actions (damage, cooldowns, resources, HP regen, shields)
    applyActions(state, llmResult);

    // 4. Guardrails
    validateState(state);

    // 5. Level-up check
    let levelUp = null;
    const champId = state.player.champion;

    // Player level-up
    const playerNewLevel = csToLevel(state.player.cs);
    if (playerNewLevel > state.player.level) {
      const pointsGained = playerNewLevel - state.player.level;
      state.player.level = playerNewLevel;
      state.player.skillPoints += pointsGained;
      recalcStats(state.player, champId);
      state.phase = 'skillup';
      levelUp = { newLevel: playerNewLevel, who: 'player' };
    }

    // Enemy level-up
    const enemyNewLevel = csToLevel(state.enemy.cs);
    if (enemyNewLevel > state.enemy.level) {
      const pointsGained = enemyNewLevel - state.enemy.level;
      state.enemy.level = enemyNewLevel;
      state.enemy.skillPoints += pointsGained;
      recalcStats(state.enemy, champId);

      // Apply enemy skillup from LLM (or auto-choose)
      applyEnemySkillUp(state.enemy, llmResult.enemySkillUp, champId);
    }

    // Also handle enemy skillup if they had pending points (not from level-up this turn)
    if (state.enemy.skillPoints > 0 && llmResult.enemySkillUp) {
      applyEnemySkillUp(state.enemy, llmResult.enemySkillUp, champId);
    }

    // 6. Game over check
    let gameOver = null;
    if (state.player.hp <= 0) {
      state.winner = 'enemy';
      gameOver = { winner: 'enemy', reason: 'kill', summary: '상대에게 처치당했습니다.' };
    } else if (state.enemy.hp <= 0) {
      state.winner = 'player';
      gameOver = { winner: 'player', reason: 'kill', summary: '상대를 처치했습니다!' };
    } else if (state.player.cs >= 50) {
      state.winner = 'player';
      gameOver = { winner: 'player', reason: 'cs', summary: 'CS 50 달성!' };
    } else if (state.enemy.cs >= 50) {
      state.winner = 'enemy';
      gameOver = { winner: 'enemy', reason: 'cs', summary: '상대가 CS 50을 먼저 달성했습니다.' };
    }

    return res.status(200).json({
      state,
      narrative: llmResult.narrative || '',
      aiChat: llmResult.aiChat || '',
      suggestions: llmResult.suggestions || [],
      levelUp,
      gameOver,
    });
  } catch (err) {
    console.error('[turn]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const CS_THRESHOLDS = [4, 10, 18, 27, 37, 48];

function isLevelUpClose(currentCs, currentLevel) {
  // Find next level threshold
  const nextThreshold = CS_THRESHOLDS.find(t => t > currentCs);
  if (!nextThreshold) return false;
  // If within 3 CS of next level, hint to LLM
  return (nextThreshold - currentCs) <= 3;
}

function applyEnemySkillUp(enemy, skillKey, champId) {
  if (!skillKey || enemy.skillPoints <= 0) return;

  const champ = loadChampion(champId);
  const skill = champ.skills[skillKey];
  if (!skill) return;

  const maxRank = skill.maxRank || 5;

  // R unlock level check
  if (skillKey === 'R' && skill.unlockLevel) {
    if (!skill.unlockLevel.includes(enemy.level)) return;
  }

  if (enemy.skillLevels[skillKey] >= maxRank) {
    // Already maxed, auto-choose another skill
    autoSkillUp(enemy, champId);
    return;
  }

  enemy.skillLevels[skillKey]++;
  enemy.skillPoints--;
}

function autoSkillUp(enemy, champId) {
  const champ = loadChampion(champId);
  // Priority: Q > W > E
  for (const key of ['Q', 'W', 'E']) {
    const skill = champ.skills[key];
    const maxRank = skill.maxRank || 5;
    if (enemy.skillLevels[key] < maxRank) {
      enemy.skillLevels[key]++;
      enemy.skillPoints--;
      return;
    }
  }
}
