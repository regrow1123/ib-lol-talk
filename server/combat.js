// V3 Combat Engine — 적중 판정 + 데미지 계산 (규칙 기반, LLM 없음)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hitMatrix = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'hit-matrix.json'), 'utf-8'));
const damageTable = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'damage-table.json'), 'utf-8'));

/**
 * resolveAction(intent, gameState, actor)
 * actor: 'player' | 'enemy'
 * returns { events: [...], stateChanges: {...} }
 */
export function resolveAction(intent, gameState, actor = 'player') {
  const attacker = actor === 'player' ? gameState.player : gameState.enemy;
  const defender = actor === 'player' ? gameState.enemy : gameState.player;
  const events = [];
  const changes = {
    attackerHp: attacker.hp,
    defenderHp: defender.hp,
    attackerEnergy: attacker.energy,
    defenderEnergy: defender.energy,
    attackerCooldowns: { ...attacker.cooldowns },
    defenderCooldowns: { ...defender.cooldowns },
    attackerPosition: attacker.position,
    defenderPosition: defender.position,
    attackerShield: attacker.shield,
    defenderShield: defender.shield,
    attackerCs: attacker.cs,
    defenderCs: defender.cs,
    attackerGold: attacker.gold,
    defenderGold: defender.gold,
    attackerBuffs: [...(attacker.buffs || [])],
    defenderBuffs: [...(defender.buffs || [])],
    attackerDebuffs: [...(attacker.debuffs || [])],
    defenderDebuffs: [...(defender.debuffs || [])],
    attackerSpellCooldowns: [...(attacker.spellCooldowns || [0, 0])],
    defenderSpellCooldowns: [...(defender.spellCooldowns || [0, 0])],
  };

  const levelDiff = attacker.level - defender.level;
  const levelScale = 1 + levelDiff * (damageTable.levelScale?.perLevel || 0.03);

  if (intent.type === 'skill' || intent.type === 'combo') {
    const skills = intent.type === 'combo' ? intent.skills : [intent.skill || intent.skills?.[0]];
    for (const skill of skills) {
      if (!skill) continue;
      const ev = resolveSkill(skill, changes, attacker, defender, levelScale, intent);
      events.push(ev);
      if (changes.defenderHp <= 0) break;
    }
  } else if (intent.type === 'farm') {
    const csGain = intent.count || 1;
    changes.attackerCs += csGain;
    changes.attackerGold += csGain * 20;
    // 기력 자연 회복
    changes.attackerEnergy = Math.min(200, changes.attackerEnergy + 20);
    events.push({ actor, action: 'farm', result: 'success', csGain, gold: csGain * 20 });
  } else if (intent.type === 'move') {
    const pos = intent.position || '중거리';
    changes.attackerPosition = pos;
    changes.attackerEnergy = Math.min(200, changes.attackerEnergy + 15);
    events.push({ actor, action: 'move', result: 'success', position: pos });
  } else if (intent.type === 'spell') {
    const ev = resolveSpell(intent, changes, attacker, defender, actor);
    events.push(ev);
  } else if (intent.type === 'passive' || intent.type === 'recall') {
    // 대기/리콜 — 에너지 회복
    const recover = intent.type === 'recall' ? 50 : 30;
    changes.attackerEnergy = Math.min(200, changes.attackerEnergy + recover);
    if (intent.type === 'recall') {
      changes.attackerHp = Math.min(100, changes.attackerHp + 15);
      changes.attackerPosition = '타워사거리';
    }
    events.push({ actor, action: intent.type, result: 'success', energyRecover: recover });
  }

  // 쿨다운 감소 (턴 끝)
  for (const k of ['Q', 'W', 'E', 'R']) {
    changes.attackerCooldowns[k] = Math.max(0, changes.attackerCooldowns[k] - 1);
    changes.defenderCooldowns[k] = Math.max(0, changes.defenderCooldowns[k] - 1);
  }
  // 소환사 주문 쿨 감소
  changes.attackerSpellCooldowns = changes.attackerSpellCooldowns.map(c => Math.max(0, c - 1));
  changes.defenderSpellCooldowns = changes.defenderSpellCooldowns.map(c => Math.max(0, c - 1));

  return { events, stateChanges: changes };
}

function resolveSkill(skill, changes, attacker, defender, levelScale, intent) {
  const skillKey = skill.replace(/[12]/, ''); // Q1→Q, E2→E
  const skillNum = skill.match(/[12]/)?.[0] || '1';
  const tableKey = skill; // Q1, Q2, W1, etc.
  const skillData = damageTable.skills[tableKey];
  const skillLevel = attacker.skillLevels[skillKey] || 0;

  // 미습득 체크
  if (skillLevel === 0) {
    return { actor: 'attacker', action: skill, result: 'unavailable', reason: '미습득' };
  }

  // 쿨다운 체크
  if (changes.attackerCooldowns[skillKey] > 0 && skillNum === '1') {
    return { actor: 'attacker', action: skill, result: 'cooldown', reason: `쿨타임 ${changes.attackerCooldowns[skillKey]}턴` };
  }

  // 기력 체크
  const cost = skillData?.cost || 0;
  if (changes.attackerEnergy < cost) {
    return { actor: 'attacker', action: skill, result: 'no_energy', reason: `기력 부족 (${changes.attackerEnergy}/${cost})` };
  }

  // 기력 소모
  changes.attackerEnergy -= cost;

  // 패시브 기력 회복 (스킬 사용 후 AA 효과 간략화)
  const passiveRecover = damageTable.passive?.energyRecover;
  if (passiveRecover) {
    const lvIdx = Math.min(attacker.level - 1, passiveRecover.first.length - 1);
    changes.attackerEnergy = Math.min(200, changes.attackerEnergy + Math.floor(passiveRecover.first[lvIdx] * 0.5));
  }

  // Q2 특수 처리: 표식 있으면 무조건 적중
  const hasQMark = skill === 'Q2' && (changes.defenderDebuffs || []).includes('음파표식');
  
  // 적중 판정
  const defenderPos = changes.defenderPosition;
  const canHit = hitMatrix.matrix[tableKey]?.[defenderPos] ?? false;
  
  if (!canHit && !hasQMark) {
    // 회피
    return { actor: 'attacker', action: skill, result: 'miss', reason: `상대 위치(${defenderPos})에서 ${skill} 회피` };
  }

  // 데미지 계산
  let damage = 0;
  if (skill === 'Q2') {
    const base = (skillData.baseDamage?.[skillLevel] || 0);
    const missingHpRatio = (100 - changes.defenderHp) / 100;
    damage = Math.round(base * (1 + missingHpRatio) * levelScale);
    // Q2 사용 시 표식 제거
    changes.defenderDebuffs = (changes.defenderDebuffs || []).filter(d => d !== '음파표식');
    // Q2는 근접으로 이동
    changes.attackerPosition = '근접';
  } else if (skill === 'W1') {
    // 쉴드 부여 (데미지 없음)
    const shieldAmt = skillData.shield?.[skillLevel] || 0;
    changes.attackerShield += shieldAmt;
    if (skillNum === '1') changes.attackerCooldowns[skillKey] = skillData.cooldown?.[skillLevel] || 12;
    return { actor: 'attacker', action: skill, result: 'shield', shieldAmount: shieldAmt };
  } else if (skill === 'W2') {
    // 피흡 버프
    const ls = skillData.lifesteal?.[skillLevel] || 0;
    changes.attackerBuffs.push(`피흡${ls}%`);
    return { actor: 'attacker', action: skill, result: 'buff', lifesteal: ls };
  } else if (skill === 'E2') {
    // 둔화
    const slow = skillData.slow?.[skillLevel] || 0;
    changes.defenderDebuffs.push(`둔화${slow}%`);
    return { actor: 'attacker', action: skill, result: 'slow', slowAmount: slow };
  } else if (skill === 'AA') {
    const lvIdx = Math.min(attacker.level - 1, (skillData.damage?.length || 1) - 1);
    damage = Math.round((skillData.damage?.[lvIdx] || 4) * levelScale);
  } else {
    damage = Math.round((skillData?.damage?.[skillLevel] || 0) * levelScale);
  }

  // Q1 적중 시 표식 부여
  if (skill === 'Q1') {
    changes.defenderDebuffs.push('음파표식');
  }

  // R 넉백 효과
  if (skill === 'R') {
    changes.defenderPosition = '원거리';
    changes.defenderDebuffs.push('넉백');
  }

  // 쿨다운 설정 (1단계 스킬만)
  if (skillNum === '1' && skillData?.cooldown) {
    changes.attackerCooldowns[skillKey] = skillData.cooldown[skillLevel] || 0;
  }

  // 쉴드 우선 차감
  if (damage > 0) {
    if (changes.defenderShield > 0) {
      const absorbed = Math.min(changes.defenderShield, damage);
      changes.defenderShield -= absorbed;
      damage -= absorbed;
    }
    changes.defenderHp = Math.max(0, changes.defenderHp - damage);
  }

  return { actor: 'attacker', action: skill, result: 'hit', damage, defenderHp: changes.defenderHp };
}

function resolveSpell(intent, changes, attacker, defender, actor) {
  const spell = intent.spell;
  const spellIdx = attacker.spells?.indexOf(spell);
  
  if (spellIdx === -1 || spellIdx === undefined) {
    return { actor, action: spell, result: 'unavailable', reason: '소환사 주문 없음' };
  }
  if (changes.attackerSpellCooldowns[spellIdx] > 0) {
    return { actor, action: spell, result: 'cooldown', reason: `쿨타임 ${changes.attackerSpellCooldowns[spellIdx]}턴` };
  }

  // 쿨다운 설정
  const spellCooldowns = { flash: 30, ignite: 18, exhaust: 21, barrier: 18, tp: 36 };
  changes.attackerSpellCooldowns[spellIdx] = spellCooldowns[spell] || 20;

  if (spell === 'flash') {
    const target = intent.purpose === 'escape' ? '타워사거리' : '근접';
    changes.attackerPosition = target;
    return { actor, action: 'flash', result: 'success', position: target };
  } else if (spell === 'ignite') {
    const damage = 5 + attacker.level;
    changes.defenderHp = Math.max(0, changes.defenderHp - damage);
    return { actor, action: 'ignite', result: 'hit', damage, defenderHp: changes.defenderHp };
  } else if (spell === 'exhaust') {
    changes.defenderDebuffs.push('탈진');
    return { actor, action: 'exhaust', result: 'success' };
  } else if (spell === 'barrier') {
    changes.attackerShield += 10;
    return { actor, action: 'barrier', result: 'success', shield: 10 };
  }

  return { actor, action: spell, result: 'success' };
}

/**
 * Merge stateChanges back into a flat stateUpdate format (compatible with validate.js)
 */
export function mergeChanges(gameState, playerChanges, aiChanges) {
  const p = gameState.player, e = gameState.enemy;
  
  return {
    playerHp: aiChanges ? aiChanges.defenderHp : playerChanges.attackerHp,
    enemyHp: aiChanges ? aiChanges.attackerHp : playerChanges.defenderHp,
    playerEnergy: aiChanges ? Math.min(200, aiChanges.defenderEnergy) : playerChanges.attackerEnergy,
    enemyEnergy: aiChanges ? aiChanges.attackerEnergy : playerChanges.defenderEnergy,
    playerCooldowns: aiChanges ? aiChanges.defenderCooldowns : playerChanges.attackerCooldowns,
    enemyCooldowns: aiChanges ? aiChanges.attackerCooldowns : playerChanges.defenderCooldowns,
    playerPosition: aiChanges ? aiChanges.defenderPosition : playerChanges.attackerPosition,
    enemyPosition: aiChanges ? aiChanges.attackerPosition : playerChanges.defenderPosition,
    playerCs: aiChanges ? aiChanges.defenderCs : playerChanges.attackerCs,
    enemyCs: aiChanges ? aiChanges.attackerCs : playerChanges.defenderCs,
    playerLevel: p.level,
    enemyLevel: e.level,
    playerGold: aiChanges ? aiChanges.defenderGold : playerChanges.attackerGold,
    enemyGold: aiChanges ? aiChanges.attackerGold : playerChanges.defenderGold,
    playerShield: aiChanges ? aiChanges.defenderShield : playerChanges.attackerShield,
    enemyShield: aiChanges ? aiChanges.attackerShield : playerChanges.defenderShield,
    playerBuffs: aiChanges ? aiChanges.defenderBuffs : playerChanges.attackerBuffs,
    enemyBuffs: aiChanges ? aiChanges.attackerBuffs : playerChanges.defenderBuffs,
    playerDebuffs: aiChanges ? aiChanges.defenderDebuffs : playerChanges.attackerDebuffs,
    enemyDebuffs: aiChanges ? aiChanges.attackerDebuffs : playerChanges.defenderDebuffs,
    playerSpellCooldowns: aiChanges ? aiChanges.defenderSpellCooldowns : playerChanges.attackerSpellCooldowns,
    enemySpellCooldowns: aiChanges ? aiChanges.attackerSpellCooldowns : playerChanges.defenderSpellCooldowns,
    towerHp: { ...gameState.tower },
    minions: JSON.parse(JSON.stringify(gameState.minions)),
  };
}
