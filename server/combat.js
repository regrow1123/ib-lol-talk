// V3 Intent Combat Engine — 의도 기반 심리전 (확률 없음, 100% 결정적)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const intentMatrix = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'intent-matrix.json'), 'utf-8'));
const damageTable = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'rules', 'damage-table.json'), 'utf-8'));

/**
 * resolveIntent(playerIntent, enemyIntent, gameState) → events[]
 * 100% 결정적: 의도 조합 → 결과 코드 → 데미지 배율
 * 확률 사용 금지
 */
export function resolveIntent(playerIntent, enemyIntent, gameState) {
  const player = gameState.player;
  const enemy = gameState.enemy;
  const events = [];

  const pMain = playerIntent.main || 'farm';
  const eMain = enemyIntent.main || 'farm';
  const pSub = playerIntent.sub || null;
  const eSub = enemyIntent.sub || null;
  const pSkills = playerIntent.skills || [];
  const eSkills = enemyIntent.skills || [];

  // 1. 메인 매트릭스 조회
  let resultCode = intentMatrix.matrix[pMain]?.[eMain] || 'MISS';

  // 2. 부행동 보정 적용
  const subResult = applySubModifiers(resultCode, pMain, eMain, pSub, eSub);
  resultCode = subResult.resultCode;
  const playerDamageScale = subResult.playerDamageScale;
  const enemyDamageScale = subResult.enemyDamageScale;

  // 3. 결과 코드 → 배율
  const multipliers = intentMatrix.resultMultipliers[resultCode] || { player: 0, enemy: 0 };
  const pMult = multipliers.player * playerDamageScale;
  const eMult = multipliers.enemy * enemyDamageScale;

  // 4. 스킬별 데미지 계산
  const levelDiff = player.level - enemy.level;
  const pLevelScale = 1 + levelDiff * (damageTable.levelScale?.perLevel || 0.03);
  const eLevelScale = 1 + (-levelDiff) * (damageTable.levelScale?.perLevel || 0.03);

  let playerTotalDmg = 0;
  let enemyTotalDmg = 0;
  const playerSkillEvents = [];
  const enemySkillEvents = [];

  // 플레이어 쿨/기력 복사 (변경 추적)
  const pCooldowns = { ...player.cooldowns };
  const eCooldowns = { ...enemy.cooldowns };
  let pEnergy = player.energy;
  let eEnergy = enemy.energy;
  let pShield = player.shield || 0;
  let eShield = enemy.shield || 0;

  // 플레이어 스킬 처리
  for (const skill of pSkills) {
    const result = processSkill(skill, player, pCooldowns, pEnergy, pLevelScale);
    pEnergy = result.energy;
    pCooldowns[result.skillKey] = result.cooldown ?? pCooldowns[result.skillKey];
    if (result.shield) pShield += result.shield;
    if (result.valid) {
      playerTotalDmg += result.damage;
      playerSkillEvents.push({ skill, ...result });
    } else {
      playerSkillEvents.push({ skill, ...result });
    }
  }

  // 적 스킬 처리
  for (const skill of eSkills) {
    const result = processSkill(skill, enemy, eCooldowns, eEnergy, eLevelScale);
    eEnergy = result.energy;
    eCooldowns[result.skillKey] = result.cooldown ?? eCooldowns[result.skillKey];
    if (result.shield) eShield += result.shield;
    if (result.valid) {
      enemyTotalDmg += result.damage;
      enemySkillEvents.push({ skill, ...result });
    } else {
      enemySkillEvents.push({ skill, ...result });
    }
  }

  // 5. 배율 적용
  const playerDealDmg = Math.round(playerTotalDmg * pMult);
  const enemyDealDmg = Math.round(enemyTotalDmg * eMult);

  // 6. 데미지 적용 (쉴드 우선 차감)
  let finalPlayerHp = player.hp;
  let finalEnemyHp = enemy.hp;

  // 적에게 가하는 데미지
  if (playerDealDmg > 0) {
    let dmg = playerDealDmg;
    if (eShield > 0) {
      const absorbed = Math.min(eShield, dmg);
      eShield -= absorbed;
      dmg -= absorbed;
    }
    finalEnemyHp = Math.max(0, finalEnemyHp - dmg);
  }

  // 플레이어가 받는 데미지
  if (enemyDealDmg > 0) {
    let dmg = enemyDealDmg;
    if (pShield > 0) {
      const absorbed = Math.min(pShield, dmg);
      pShield -= absorbed;
      dmg -= absorbed;
    }
    finalPlayerHp = Math.max(0, finalPlayerHp - dmg);
  }

  // 7. 위치 업데이트
  const pPos = intentMatrix.positionResults[pMain] || player.position;
  const ePos = intentMatrix.positionResults[eMain] || enemy.position;

  // zone 부행동: 상대 farm이면 CS 0, 상대 dodge이면 원거리로 밀림
  let enemyPosFinal = ePos || enemy.position;
  let playerPosFinal = pPos || player.position;
  if (pSub === 'zone' && eMain === 'dodge') enemyPosFinal = '원거리';
  if (eSub === 'zone' && pMain === 'dodge') playerPosFinal = '원거리';

  // 8. CS 처리
  let pCsGain = 0;
  let eCsGain = 0;

  if (resultCode === 'FARM_BOTH') {
    pCsGain = 2;
    eCsGain = 2;
  }
  if (pMain === 'farm' && resultCode !== 'PUNISH_E' && resultCode !== 'FARM_BOTH') {
    pCsGain = 2;
  }
  if (eMain === 'farm' && resultCode !== 'PUNISH_P' && resultCode !== 'FARM_BOTH') {
    eCsGain = 2;
  }

  // farm_side 부행동: CS +1
  if (pSub === 'farm_side') pCsGain += 1;
  if (eSub === 'farm_side') eCsGain += 1;

  // zone 부행동: 상대 farm이면 CS 0
  if (pSub === 'zone' && eMain === 'farm') eCsGain = 0;
  if (eSub === 'zone' && pMain === 'farm') pCsGain = 0;

  // 9. 기력 자연 회복 (비전투 행동)
  if (['farm', 'defend', 'dodge'].includes(pMain)) pEnergy = Math.min(200, pEnergy + 20);
  if (['farm', 'defend', 'dodge'].includes(eMain)) eEnergy = Math.min(200, eEnergy + 20);

  // 10. 쿨다운 감소 (턴 끝)
  for (const k of ['Q', 'W', 'E', 'R']) {
    pCooldowns[k] = Math.max(0, (pCooldowns[k] || 0) - 1);
    eCooldowns[k] = Math.max(0, (eCooldowns[k] || 0) - 1);
  }

  // 이벤트 생성
  events.push({
    type: 'intent_resolution',
    playerMain: pMain,
    playerSub: pSub,
    enemyMain: eMain,
    enemySub: eSub,
    resultCode,
    playerDamageDealt: playerDealDmg,
    enemyDamageDealt: enemyDealDmg,
    playerSkills: playerSkillEvents,
    enemySkills: enemySkillEvents,
  });

  // 상태 변경 요약
  const stateChanges = {
    playerHp: finalPlayerHp,
    enemyHp: finalEnemyHp,
    playerEnergy: Math.min(200, pEnergy),
    enemyEnergy: Math.min(200, eEnergy),
    playerCooldowns: pCooldowns,
    enemyCooldowns: eCooldowns,
    playerPosition: playerPosFinal,
    enemyPosition: enemyPosFinal,
    playerCs: player.cs + pCsGain,
    enemyCs: enemy.cs + eCsGain,
    playerGold: player.gold + pCsGain * 20,
    enemyGold: enemy.gold + eCsGain * 20,
    playerShield: pShield,
    enemyShield: eShield,
    playerBuffs: [...(player.buffs || [])],
    enemyBuffs: [...(enemy.buffs || [])],
    playerDebuffs: [...(player.debuffs || [])],
    enemyDebuffs: [...(enemy.debuffs || [])],
    playerSpellCooldowns: [...(player.spellCooldowns || [0, 0])],
    enemySpellCooldowns: [...(enemy.spellCooldowns || [0, 0])],
    playerLevel: player.level,
    enemyLevel: enemy.level,
    towerHp: { ...gameState.tower },
    minions: JSON.parse(JSON.stringify(gameState.minions)),
  };

  // 소환사 주문 쿨 감소
  stateChanges.playerSpellCooldowns = stateChanges.playerSpellCooldowns.map(c => Math.max(0, c - 1));
  stateChanges.enemySpellCooldowns = stateChanges.enemySpellCooldowns.map(c => Math.max(0, c - 1));

  return { events, stateChanges };
}

/**
 * 부행동 보정 적용
 */
function applySubModifiers(resultCode, pMain, eMain, pSub, eSub) {
  let playerDamageScale = 1.0;
  let enemyDamageScale = 1.0;
  let code = resultCode;

  // 플레이어 dodge_ready: 받는 데미지 70%, PUNISH 취소
  if (pSub === 'dodge_ready') {
    if (code === 'PUNISH_E' || code === 'E_HIT' || code === 'E_ADV' || code === 'TRADE') {
      enemyDamageScale *= 0.7;
    }
    if (code === 'PUNISH_E') {
      code = 'E_HIT'; // PUNISH → 일반 HIT
    }
  }

  // 적 dodge_ready: 적이 받는 데미지 70%, PUNISH 취소
  if (eSub === 'dodge_ready') {
    if (code === 'PUNISH_P' || code === 'P_HIT' || code === 'P_ADV' || code === 'TRADE') {
      playerDamageScale *= 0.7;
    }
    if (code === 'PUNISH_P') {
      code = 'P_HIT'; // PUNISH → 일반 HIT
    }
  }

  // 플레이어 poke_ready: farm/defend + 상대 farm/dodge → P_HIT
  if (pSub === 'poke_ready') {
    if (['farm', 'defend'].includes(pMain) && ['farm', 'dodge'].includes(eMain)) {
      code = 'P_HIT';
    }
  }

  // 적 poke_ready
  if (eSub === 'poke_ready') {
    if (['farm', 'defend'].includes(eMain) && ['farm', 'dodge'].includes(pMain)) {
      code = 'E_HIT';
    }
  }

  // 플레이어 bait: 상대가 all_in/trade로 달려들면 BAIT_SUCCESS
  if (pSub === 'bait') {
    if (['all_in', 'trade'].includes(eMain)) {
      code = 'BAIT_SUCCESS';
    } else {
      // 안 물면 시간 낭비
      if (code === 'MISS' || code === 'FARM_BOTH') {
        // 유지
      } else {
        code = 'MISS';
      }
    }
  }

  // 적 bait
  if (eSub === 'bait') {
    if (['all_in', 'trade'].includes(pMain)) {
      // 적의 bait 성공 = 플레이어가 속음
      code = 'E_ADV'; // 적에게 유리하게 (BAIT_SUCCESS 반전)
      enemyDamageScale = 1.2;
      playerDamageScale = 0.5;
    } else {
      if (code === 'MISS' || code === 'FARM_BOTH') {
        // 유지
      } else {
        code = 'MISS';
      }
    }
  }

  return { resultCode: code, playerDamageScale, enemyDamageScale };
}

/**
 * 스킬 처리: 쿨다운/기력 체크, 데미지 계산
 */
function processSkill(skill, fighter, cooldowns, energy, levelScale) {
  const skillKey = skill.replace(/[12]/, '');
  const skillNum = skill.match(/[12]/)?.[0] || '1';
  const skillData = damageTable.skills[skill];
  const skillLevel = fighter.skillLevels?.[skillKey] || 0;

  if (skillLevel === 0) {
    return { valid: false, reason: '미습득', damage: 0, energy, skillKey };
  }

  if (skillNum === '1' && cooldowns[skillKey] > 0) {
    return { valid: false, reason: `쿨타임 ${cooldowns[skillKey]}턴`, damage: 0, energy, skillKey };
  }

  const cost = skillData?.cost || 0;
  if (energy < cost) {
    return { valid: false, reason: `기력 부족`, damage: 0, energy, skillKey };
  }

  energy -= cost;

  // 패시브 기력 회복
  const passiveRecover = damageTable.passive?.energyRecover;
  if (passiveRecover) {
    const lvIdx = Math.min(fighter.level - 1, passiveRecover.first.length - 1);
    energy = Math.min(200, energy + Math.floor(passiveRecover.first[lvIdx] * 0.5));
  }

  let damage = 0;
  let shield = 0;
  let cooldown = undefined;

  if (skill === 'W1') {
    shield = skillData.shield?.[skillLevel] || 0;
    cooldown = skillData.cooldown?.[skillLevel] || 12;
    return { valid: true, damage: 0, shield, energy, skillKey, cooldown };
  }

  if (skill === 'W2' || skill === 'E2') {
    // 버프/디버프 — 0 데미지
    return { valid: true, damage: 0, energy, skillKey };
  }

  if (skill === 'Q2') {
    const base = skillData.baseDamage?.[skillLevel] || 0;
    // Q2: 잃은 체력 비례 (대상의 잃은 체력은 모르므로 기본 1.5배로 근사)
    damage = Math.round(base * 1.5 * levelScale);
  } else if (skill === 'AA') {
    const lvIdx = Math.min(fighter.level - 1, (skillData.damage?.length || 1) - 1);
    damage = Math.round((skillData.damage?.[lvIdx] || 4) * levelScale);
  } else {
    damage = Math.round((skillData?.damage?.[skillLevel] || 0) * levelScale);
  }

  // 쿨다운 설정 (1단계 스킬)
  if (skillNum === '1' && skillData?.cooldown) {
    cooldown = skillData.cooldown[skillLevel] || 0;
  }

  return { valid: true, damage, energy, skillKey, cooldown };
}
