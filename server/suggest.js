// V3 Suggestions — 규칙 기반 (LLM 없음)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sugData = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'suggestions.json'), 'utf-8'));

/**
 * generateSuggestions(gameState) → string[]
 * 1~3개, 이모지 금지, 상황 기반
 */
export function generateSuggestions(gameState) {
  const p = gameState.player;
  const e = gameState.enemy;
  const categories = [];

  // 상황 분석
  const aggressive = e.hp < 40 || (e.cooldowns.Q > 0 && e.cooldowns.E > 0) || p.level > e.level || p.energy >= 150;
  const defensive = p.hp < 35 || p.energy < 50;
  const hasQE = p.skillLevels.Q > 0 && p.skillLevels.E > 0 && p.cooldowns.Q === 0 && p.cooldowns.E === 0;
  const hasR = p.skillLevels.R > 0 && p.cooldowns.R === 0;

  if (aggressive && !defensive) categories.push('aggressive');
  if (defensive) categories.push('defensive');
  if (!aggressive && !defensive) categories.push('utility');
  if (hasQE || hasR) categories.push('combo');

  // 기본값
  if (categories.length === 0) categories.push('utility');

  // 템플릿에서 선택
  const results = [];
  const seen = new Set();

  for (const cat of categories) {
    const templates = sugData.categories[cat]?.templates || [];
    if (templates.length === 0) continue;

    // 랜덤 1~2개 선택
    const shuffled = [...templates].sort(() => Math.random() - 0.5);
    for (const tmpl of shuffled) {
      if (results.length >= 3) break;
      const filled = fillTemplate(tmpl, p, e);
      if (seen.has(filled)) continue;
      seen.add(filled);
      results.push(filled);
    }
  }

  return results.slice(0, 3);
}

function fillTemplate(tmpl, player, enemy) {
  // 사용 가능한 내 스킬 찾기
  const mySkills = [];
  for (const k of ['Q', 'W', 'E', 'R']) {
    if (player.skillLevels[k] > 0 && player.cooldowns[k] === 0) {
      mySkills.push(k + '1');
    }
  }
  const mySkill = mySkills[0] || 'AA';

  // 상대 쿨다운 중인 스킬
  const enemyCdSkills = [];
  for (const k of ['Q', 'W', 'E', 'R']) {
    if (enemy.cooldowns[k] > 0) enemyCdSkills.push(k);
  }
  const enemySkill = enemyCdSkills[0] || 'Q';

  return tmpl
    .replace('{my_skill}', mySkill)
    .replace('{enemy_skill}', enemySkill)
    .replace('{enemy_hp}', String(enemy.hp))
    .replace('{enemy_energy}', String(enemy.energy))
    .replace('{player_hp}', String(player.hp));
}
