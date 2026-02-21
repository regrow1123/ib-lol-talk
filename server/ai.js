// V3 AI Engine — 성격 기반 의도 결정 (가중치 랜덤)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const personalities = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'ai-personalities.json'), 'utf-8')).personalities;
const damageTable = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'damage-table.json'), 'utf-8'));

const PERSONALITIES = ['aggressive', 'calculated', 'reactive'];

/**
 * assignPersonality() → 랜덤 성격 배정
 */
export function assignPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

/**
 * decideAiAction(gameState, playerHistory) → { main, sub, skills }
 * playerHistory: 최근 턴들의 playerIntent 배열
 */
export function decideAiAction(gameState, playerHistory = []) {
  const ai = gameState.enemy;
  const player = gameState.player;
  const personality = personalities[ai.personality] || personalities.aggressive;

  // 1. 상황 태그 생성
  const tags = buildSituationTags(ai, player, playerHistory);

  // 2. 태그별 가중치 합산
  const scores = { all_in: 0, trade: 0, poke: 0, dodge: 0, farm: 0, defend: 0 };
  let tagCount = 0;

  for (const tag of tags) {
    const weights = personality.tendencies[tag];
    if (!weights) continue;
    tagCount++;
    for (const action in weights) {
      scores[action] = (scores[action] || 0) + weights[action];
    }
  }

  // 태그 없으면 default
  if (tagCount === 0) {
    const def = personality.tendencies.default || {};
    for (const action in def) {
      scores[action] = (scores[action] || 0) + def[action];
    }
  }

  // 3. 사용 불가 행동 필터
  applyAvailabilityFilter(scores, ai);

  // 4. 가중치 기반 선택 (AI 성향이므로 가중치 랜덤 OK)
  const mainAction = weightedRandom(scores);

  // 5. 부행동 선택
  const subAction = chooseSub(mainAction, ai.personality, personality);

  // 6. 스킬 선택
  const skills = chooseSkills(mainAction, ai);

  return { main: mainAction, sub: subAction, skills };
}

function buildSituationTags(ai, player, playerHistory) {
  const tags = [];
  const hpDiff = ai.hp - player.hp;

  // HP 상황
  if (hpDiff >= 15) tags.push('hp_advantage');
  else if (hpDiff <= -15) tags.push('hp_disadvantage');
  else tags.push('hp_even');

  // 킬각 (상대 HP 30% 이하이고 내 스킬 있으면)
  if (player.hp <= 30 && ai.hp > 20) tags.push('kill_range');

  // 스킬 상태
  const hasMainSkills = (ai.skillLevels.Q > 0 && ai.cooldowns.Q === 0) ||
                        (ai.skillLevels.E > 0 && ai.cooldowns.E === 0);
  if (hasMainSkills && ai.energy >= 50) {
    tags.push('skills_ready');
  } else {
    tags.push('skills_on_cd');
  }

  // 기력
  if (ai.energy < 50) tags.push('energy_low');

  // 레벨
  if (ai.level > player.level) tags.push('level_advantage');

  // 플레이어 행동 분석 (최근 3턴)
  const recent = playerHistory.slice(-3);
  if (recent.length > 0) {
    const aggressiveCount = recent.filter(h =>
      ['all_in', 'trade'].includes(h?.main)
    ).length;
    const passiveCount = recent.filter(h =>
      ['farm', 'defend', 'dodge'].includes(h?.main)
    ).length;

    if (aggressiveCount >= 2) tags.push('player_aggressive');
    else if (passiveCount >= 2) tags.push('player_passive');
    
    const farmCount = recent.filter(h => h?.main === 'farm').length;
    if (farmCount >= 2) tags.push('player_farming');
  }

  return tags;
}

function applyAvailabilityFilter(scores, ai) {
  // 스킬 없거나 쿨이면 공격 행동 감소
  const hasQ = ai.skillLevels.Q > 0 && ai.cooldowns.Q === 0 && ai.energy >= 50;
  const hasE = ai.skillLevels.E > 0 && ai.cooldowns.E === 0 && ai.energy >= 50;
  const hasR = ai.skillLevels.R > 0 && ai.cooldowns.R === 0;

  if (!hasQ && !hasE) {
    scores.all_in = Math.floor((scores.all_in || 0) * 0.2);
    scores.trade = Math.floor((scores.trade || 0) * 0.3);
    scores.poke = Math.floor((scores.poke || 0) * 0.3);
  }

  if (!hasR) {
    scores.all_in = Math.floor((scores.all_in || 0) * 0.5);
  }

  if (ai.energy < 30) {
    scores.all_in = 0;
    scores.trade = Math.floor((scores.trade || 0) * 0.2);
    scores.poke = Math.floor((scores.poke || 0) * 0.3);
  }

  // 최소 1 보장
  for (const a in scores) {
    scores[a] = Math.max(1, scores[a] || 0);
  }
}

function chooseSub(mainAction, personalityKey, personality) {
  const prefs = personality.sub_preferences?.[mainAction];
  if (!prefs || prefs.length === 0) return null;
  // 균등 랜덤 선택
  return prefs[Math.floor(Math.random() * prefs.length)];
}

function chooseSkills(mainAction, ai) {
  const skills = [];

  const canUse = (key) => {
    return ai.skillLevels[key] > 0 && ai.cooldowns[key] === 0;
  };
  const hasEnergy = (cost) => ai.energy >= cost;

  switch (mainAction) {
    case 'all_in':
      if (canUse('Q') && hasEnergy(50)) skills.push('Q1', 'Q2');
      if (canUse('E') && hasEnergy(50)) skills.push('E1');
      if (canUse('R')) skills.push('R');
      if (skills.length > 0) skills.push('AA');
      break;
    case 'trade':
      if (canUse('Q') && hasEnergy(50)) skills.push('Q1', 'AA', 'Q2');
      else if (canUse('E') && hasEnergy(50)) skills.push('E1', 'AA');
      else skills.push('AA');
      break;
    case 'poke':
      if (canUse('Q') && hasEnergy(50)) skills.push('Q1');
      else if (canUse('E') && hasEnergy(50)) skills.push('E1');
      else skills.push('AA');
      break;
    case 'dodge':
      if (canUse('W') && hasEnergy(50)) skills.push('W1');
      break;
    case 'farm':
      skills.push('AA');
      break;
    case 'defend':
      if (canUse('W') && hasEnergy(50)) skills.push('W1');
      break;
  }

  if (skills.length === 0) skills.push('AA');
  return skills;
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
