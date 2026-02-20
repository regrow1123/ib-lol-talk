// Damage calculation — exact LoL formulas
import { LEE_SIN } from './champion.js';

export function calcPhysicalDamage(rawDamage, targetArmor) {
  if (targetArmor >= 0) {
    return Math.round(rawDamage * 100 / (100 + targetArmor) * 10) / 10;
  }
  return Math.round(rawDamage * (2 - 100 / (100 - targetArmor)) * 10) / 10;
}

export function calcMagicDamage(rawDamage, targetMr) {
  if (targetMr >= 0) {
    return Math.round(rawDamage * 100 / (100 + targetMr) * 10) / 10;
  }
  return Math.round(rawDamage * (2 - 100 / (100 - targetMr)) * 10) / 10;
}

// Returns raw damage before resistances
export function getSkillRawDamage(skill, part, attacker, target) {
  const s = LEE_SIN.skills[skill];
  const skillLevel = attacker.skillLevels[skill] || 0;
  const lvl = Math.max(0, skillLevel - 1); // Convert skill level to array index (level 1 = index 0)

  if (skill === 'Q' && part === 1) {
    return s.baseDamage1[lvl] + s.bonusAdRatio1 * attacker.bonusAd;
  }
  if (skill === 'Q' && part === 2) {
    const base = s.baseDamage2[lvl] + s.bonusAdRatio2 * attacker.bonusAd;
    const missingHpPercent = 1 - (target.hp / target.maxHp);
    const bonusMultiplier = 1 + missingHpPercent; // 0-100% increase
    return base * bonusMultiplier;
  }
  if (skill === 'W' && part === 1) {
    // Shield, not damage
    return s.shieldBase[lvl]; // + AP ratio (no AP in prototype)
  }
  if (skill === 'E' && part === 1) {
    return s.baseDamage1[lvl] + s.totalAdRatio1 * attacker.totalAd;
  }
  if (skill === 'R' && part === 1) {
    return s.baseDamage1[0] + s.bonusAdRatio1 * attacker.bonusAd;
  }
  return 0;
}

export function calcAutoAttackDamage(attacker, target) {
  return calcPhysicalDamage(attacker.totalAd, target.armor);
}

export function calcQ1Damage(attacker, target) {
  const raw = getSkillRawDamage('Q', 1, attacker, target);
  return calcPhysicalDamage(raw, target.armor);
}

export function calcQ2Damage(attacker, target) {
  const raw = getSkillRawDamage('Q', 2, attacker, target);
  return calcPhysicalDamage(raw, target.armor);
}

export function calcE1Damage(attacker, target) {
  const raw = getSkillRawDamage('E', 1, attacker, target);
  return calcMagicDamage(raw, target.mr);
}

export function calcRDamage(attacker, target) {
  const raw = getSkillRawDamage('R', 1, attacker, target);
  return calcPhysicalDamage(raw, target.armor);
}

export function calcW1Shield(attacker) {
  return getSkillRawDamage('W', 1, attacker, null);
}
