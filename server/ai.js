// V3 AI Engine — 가중치 기반 행동 결정 (LLM 없음)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const aiWeights = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'ai-weights.json'), 'utf-8'));

/**
 * decideAiAction(gameState, playerAction)
 * playerAction: { events, stateChanges } from player's resolveAction
 * returns: intent for AI
 */
export function decideAiAction(gameState, playerAction) {
  const ai = gameState.enemy;
  const player = gameState.player;
  const th = aiWeights.thresholds;

  // 상황 태그 생성
  const tags = [];
  
  if (ai.hp >= th.hp_high) tags.push('hp_high');
  else if (ai.hp >= th.hp_mid_low) tags.push('hp_mid');
  else tags.push('hp_low');

  if (ai.energy >= th.energy_high) tags.push('energy_high');
  else if (ai.energy < th.energy_low) tags.push('energy_low');

  if (playerAction?.stateChanges?.defenderHp < th.enemy_hp_low ||
      player.hp < th.enemy_hp_low) {
    tags.push('enemy_hp_low');
  }

  if (player.cooldowns.Q > 0) tags.push('enemy_cd_q');
  if (player.cooldowns.E > 0) tags.push('enemy_cd_e');

  if (ai.level > player.level) tags.push('level_advantage');
  if (ai.level < player.level) tags.push('level_disadvantage');

  if (ai.skillLevels.R > 0 && ai.cooldowns.R === 0) tags.push('has_r');

  // 플레이어 행동 분석
  const playerEvents = playerAction?.events || [];
  const playerAttacked = playerEvents.some(e => e.result === 'hit');
  const playerFarmed = playerEvents.some(e => e.action === 'farm');
  if (playerAttacked) tags.push('player_aggressive');
  if (playerFarmed) tags.push('player_farming');

  // 가중치 합산
  const scores = { trade: 0, farm: 0, poke: 0, all_in: 0, retreat: 0, shield: 0 };
  for (const tag of tags) {
    const w = aiWeights.situationWeights[tag];
    if (!w) continue;
    for (const action in scores) {
      scores[action] += w[action] || 0;
    }
  }

  // 음수 제거 + 최소 1
  for (const a in scores) {
    scores[a] = Math.max(1, scores[a]);
  }

  // 사용 불가 행동 필터
  if (ai.skillLevels.Q === 0 || ai.cooldowns.Q > 0 || ai.energy < 50) {
    scores.poke = 0;
    scores.all_in = Math.floor(scores.all_in * 0.3);
  }
  if (ai.skillLevels.W === 0 || ai.cooldowns.W > 0 || ai.energy < 50) {
    scores.shield = 0;
    scores.retreat = Math.max(scores.retreat, 5); // 스킬 없어도 후퇴 가능
  }
  if (ai.skillLevels.R === 0 || ai.cooldowns.R > 0) {
    scores.all_in = Math.floor(scores.all_in * 0.5);
  }
  if (ai.skillLevels.E === 0 || ai.cooldowns.E > 0 || ai.energy < 50) {
    scores.trade = Math.floor(scores.trade * 0.6);
  }

  // 확률적 선택
  const action = weightedRandom(scores);
  return buildIntent(action, ai);
}

function weightedRandom(scores) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return 'farm';
  
  let r = Math.random() * total;
  for (const [action, weight] of Object.entries(scores)) {
    r -= weight;
    if (r <= 0) return action;
  }
  return 'farm';
}

function buildIntent(action, ai) {
  const template = aiWeights.actionSkills[action];
  if (!template) return { type: 'passive', desc: '관망' };

  // 사용 가능한 스킬만 필터
  const available = template.skills.filter(s => {
    const key = s.replace(/[12]/, '');
    const num = s.match(/[12]/)?.[0] || '1';
    if (ai.skillLevels[key] === 0) return false;
    if (num === '1' && ai.cooldowns[key] > 0) return false;
    const costs = { Q1: 50, Q2: 25, W1: 50, W2: 0, E1: 50, E2: 0, R: 0, AA: 0 };
    if (ai.energy < (costs[s] || 0)) return false;
    return true;
  });

  if (available.length === 0) {
    // 스킬 없으면 AA로 파밍
    return { type: 'farm', method: 'AA', count: 1 };
  }

  if (available.length === 1) {
    return { type: 'skill', skill: available[0], intent: action };
  }

  return { type: 'combo', skills: available, intent: action };
}
