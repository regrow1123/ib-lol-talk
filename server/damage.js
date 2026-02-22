// Damage engine — LoL formula-based calculations
import { loadChampion } from './champions.js';

/**
 * Process LLM actions and compute state changes.
 * @param {object} state - current game state
 * @param {object} llmResult - LLM response (actions, distance, blocked, cs, enemySkillUp)
 * @returns {object} updated state (mutated)
 */
export function applyActions(state, llmResult) {
  const actions = llmResult.actions || [];
  const champ = loadChampion(state.player.champion);

  // Process each action in order
  for (const action of actions) {
    const attacker = action.who === 'player' ? state.player : state.enemy;
    const defender = action.who === 'player' ? state.enemy : state.player;

    // Skip invalid actions
    if (!validateAction(action, attacker, champ)) continue;

    if (!action.hit) {
      // Miss — no damage, but still consume resource and apply cooldown
      consumeResource(action, attacker, champ);
      applyCooldown(action, attacker, champ);
      continue;
    }

    // Calculate and apply damage/effects
    const result = calculateSkillEffect(action, attacker, defender, champ);

    // Apply damage (through shield first)
    if (result.damage > 0) {
      applyDamage(defender, result.damage);
    }

    // Apply shield
    if (result.shield > 0) {
      attacker.shield += result.shield;
    }

    // Consume resource for skill usage
    consumeResource(action, attacker, champ);

    // Apply cooldown on skill use
    applyCooldown(action, attacker, champ);
  }

  // Elapsed time processing
  const elapsedSec = ELAPSED_MAP[llmResult.elapsed] || ELAPSED_MAP.medium;

  // Decrement cooldowns by elapsed time
  decrementCooldowns(state.player, elapsedSec);
  decrementCooldowns(state.enemy, elapsedSec);

  // Natural recovery based on elapsed time
  recoverResource(state.player, champ, elapsedSec);
  recoverResource(state.enemy, champ, elapsedSec);
  recoverHp(state.player, champ, elapsedSec);
  recoverHp(state.enemy, champ, elapsedSec);

  // Update distance and blocked
  if (llmResult.distance != null) state.distance = Math.max(0, llmResult.distance);
  if (llmResult.blocked != null) state.blocked = llmResult.blocked;

  // Apply CS
  if (llmResult.cs) {
    state.player.cs += (llmResult.cs.player || 0);
    state.enemy.cs += (llmResult.cs.enemy || 0);
  }

  // Update minions
  if (llmResult.minions) {
    state.minions = llmResult.minions;
  }

  // Shield decay (simplified: shield lasts 1 turn)
  state.player.shield = 0;
  state.enemy.shield = 0;

  return state;
}

function validateAction(action, attacker, champ) {
  const skill = action.skill;
  if (!skill) return false;

  // AA is always valid
  if (skill === 'AA') return true;

  // Parse skill key (Q1→Q, W2→W, R→R)
  const key = skill.replace(/[12]/, '');
  if (!['Q', 'W', 'E', 'R'].includes(key)) return true; // spells etc, pass through

  // Check if learned
  if (attacker.skillLevels[key] <= 0) return false;

  // Check cooldown (already 0 means ready — cooldowns are decremented after actions)
  // Note: cooldown check is loose since LLM already judged
  return true;
}

function calculateSkillEffect(action, attacker, defender, champ) {
  const skill = action.skill;
  let damage = 0;
  let shield = 0;

  if (skill === 'AA') {
    // Basic attack: AD vs armor
    damage = applyArmor(attacker.ad, defender.armor);
    return { damage, shield };
  }

  const key = skill.replace(/[12]/, '');
  const phase = skill.endsWith('2') ? 1 : 0; // index: 0 = first cast, 1 = recast
  const skillData = champ.skills[key];
  if (!skillData) return { damage, shield };

  const rank = attacker.skillLevels[key];
  if (rank <= 0) return { damage, shield };

  // Base damage
  const baseDmg = skillData.baseDamage?.[phase]?.[rank - 1] || 0;

  // Scaling
  const scalingData = skillData.scaling?.[phase];
  let scalingDmg = 0;
  if (scalingData) {
    const statValue = getStatValue(attacker, scalingData.stat);
    scalingDmg = statValue * scalingData.ratio;
  }

  let rawDamage = baseDmg + scalingDmg;

  // Q2 special: missing HP ratio (0~100% bonus based on target missing HP%)
  if (skill === 'Q2' && key === 'Q') {
    const missingHpRatio = 1 - (defender.hp / defender.maxHp);
    rawDamage *= (1 + missingHpRatio); // 1x ~ 2x
  }

  // Apply resistance
  const dmgType = skillData.damageType?.[phase];
  if (dmgType === 'physical') {
    damage = applyArmor(rawDamage, defender.armor);
  } else if (dmgType === 'magic') {
    damage = applyMR(rawDamage, defender.mr);
  } else {
    damage = rawDamage; // true damage
  }

  // W1 shield
  if (skill === 'W1' && skillData.shield) {
    shield = skillData.shield[rank - 1] || 0;
  }

  return { damage: Math.round(damage), shield: Math.round(shield) };
}

function getStatValue(fighter, stat) {
  switch (stat) {
    case 'bonusAD': return fighter.ad - fighter.baseAd;
    case 'totalAD': return fighter.ad;
    case 'AP': return 0; // Lee Sin has no AP
    default: return 0;
  }
}

function applyArmor(damage, armor) {
  return damage * (100 / (100 + armor));
}

function applyMR(damage, mr) {
  return damage * (100 / (100 + mr));
}

function applyDamage(defender, damage) {
  // Shield absorbs first
  if (defender.shield > 0) {
    if (defender.shield >= damage) {
      defender.shield -= damage;
      return;
    }
    damage -= defender.shield;
    defender.shield = 0;
  }
  defender.hp = Math.max(0, Math.round(defender.hp - damage));
}

// Elapsed time mapping
const ELAPSED_MAP = {
  instant: 1,    // single skill exchange
  short: 3,      // short combo/trade
  medium: 6,     // CS + minor actions
  long: 10,      // farming phase
  very_long: 15, // long standoff, recall wait
};

function consumeResource(action, attacker, champ) {
  const skill = action.skill;
  if (skill === 'AA') return;

  const key = skill.replace(/[12]/, '');
  const phase = skill.endsWith('2') ? 1 : 0;
  const skillData = champ.skills[key];
  if (!skillData) return;

  const cost = skillData.cost?.[phase] || 0;
  attacker.resource = Math.max(0, attacker.resource - cost);
}

function applyCooldown(action, attacker, champ) {
  const skill = action.skill;
  if (skill === 'AA') return;

  const key = skill.replace(/[12]/, '');
  const skillData = champ.skills[key];
  if (!skillData) return;

  // Recast: cooldown starts on first cast (regardless of phase 2)
  const rank = attacker.skillLevels[key];
  const cd = skillData.cooldown?.[rank - 1] || 0;

  // Only set if not already on cooldown (avoid resetting on Q2 after Q1)
  if (attacker.cooldowns[key] <= 0) {
    attacker.cooldowns[key] = cd;
  }
}

function decrementCooldowns(fighter, elapsedSec) {
  for (const key of Object.keys(fighter.cooldowns)) {
    fighter.cooldowns[key] = Math.max(0, fighter.cooldowns[key] - elapsedSec);
  }
  for (let i = 0; i < fighter.spellCooldowns.length; i++) {
    fighter.spellCooldowns[i] = Math.max(0, fighter.spellCooldowns[i] - elapsedSec);
  }
}

function recoverHp(fighter, champ, elapsedSec) {
  const baseRegen = champ.baseStats.hpRegen || 0;
  const regenPerLevel = champ.baseStats.hpRegenPerLevel || 0;
  const regen = baseRegen + regenPerLevel * (fighter.level - 1);
  fighter.hp = Math.min(fighter.maxHp, Math.round(fighter.hp + regen * elapsedSec));
}

function recoverResource(fighter, champ, elapsedSec) {
  if (champ.resource === 'energy') {
    // Energy recovers 50/sec
    fighter.resource = Math.min(fighter.maxResource, fighter.resource + 50 * elapsedSec);
  }
  // Mana recovery can be added here for other champions
}
