import Anthropic from '@anthropic-ai/sdk';
import { callResolve } from '../server/llm.js';
import { applyActions } from '../server/damage.js';
import { validateState } from '../server/validate.js';
import { csToLevel, recalcStats } from '../server/game.js';
import { loadChampion } from '../server/champions.js';

const TIPS_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
let tipsClient = null;

async function generateTips(history, gameOver, state) {
  if (!tipsClient) tipsClient = new Anthropic();

  const lastMsgs = history.slice(-10).map(h => {
    const role = h.role === 'user' ? '플레이어' : '상대';
    return `${role}: ${typeof h.content === 'string' ? h.content : JSON.stringify(h.content)}`;
  }).join('\n');

  const prompt = `이번 리신 vs 리신 1v1 라인전이 끝났다.
결과: ${gameOver.winner === 'player' ? '플레이어 승리' : '플레이어 패배'} (${gameOver.reason === 'kill' ? '킬' : 'CS 50'})
최종 상태: 플레이어 HP ${state.player.hp}/${state.player.maxHp}, CS ${state.player.cs} | 상대 HP ${state.enemy.hp}/${state.enemy.maxHp}, CS ${state.enemy.cs}

최근 전투 기록:
${lastMsgs}

이번 라인전에서 플레이어가 배울 수 있는 실전 꿀팁 3개를 JSON 배열로 줘.
각 팁은 이번 경기에서 실제로 있었던 상황을 근거로, 구체적이고 실용적으로 써.
리신 스킬 메카닉, 교전 타이밍, CS 관리 등 다양한 주제로.
형식: ["팁1","팁2","팁3"]
JSON만 출력.`;

  const resp = await tipsClient.messages.create({
    model: TIPS_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content[0]?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameState, playerAction, input, enemyAction, history } = req.body || {};
  if (!gameState || !enemyAction) {
    return res.status(400).json({ error: 'Missing gameState or enemyAction' });
  }
  if (!playerAction && !input) {
    return res.status(400).json({ error: 'Missing playerAction or input' });
  }

  const isFreeText = !playerAction && !!input;
  const playerIntent = playerAction || input;

  try {
    // 1. Call LLM (resolve)
    const llmResult = await callResolve(gameState, playerIntent, enemyAction, isFreeText, history || []);

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
      applyEnemySkillUp(state.enemy, llmResult.enemySkillUp, champId);
    }

    // Also handle enemy skillup if they had pending points
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

    // Generate tips on game over
    let tips = null;
    if (gameOver) {
      try {
        tips = await generateTips(history || [], gameOver, state);
      } catch (e) {
        console.error('[tips]', e);
      }
    }

    return res.status(200).json({
      state,
      narrative: llmResult.narrative || '',
      aiChat: llmResult.aiChat || '',
      levelUp,
      gameOver,
      tips,
    });
  } catch (err) {
    console.error('[turn]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function applyEnemySkillUp(enemy, skillKey, champId) {
  if (!skillKey || enemy.skillPoints <= 0) return;

  const champ = loadChampion(champId);
  const skill = champ.skills[skillKey];
  if (!skill) return;

  const maxRank = skill.maxRank || 5;

  if (skillKey === 'R' && skill.unlockLevel) {
    if (!skill.unlockLevel.includes(enemy.level)) return;
  }

  if (enemy.skillLevels[skillKey] >= maxRank) {
    autoSkillUp(enemy, champId);
    return;
  }

  enemy.skillLevels[skillKey]++;
  enemy.skillPoints--;
}

function autoSkillUp(enemy, champId) {
  const champ = loadChampion(champId);
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
