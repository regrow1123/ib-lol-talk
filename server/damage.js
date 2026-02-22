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
      // Miss — still consume resource; recast skills start cooldown on miss
      consumeResource(action, attacker, champ);
      applyCooldownForced(action, attacker, champ); // miss = cooldown starts immediately
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

    // Apply resource cost
    consumeResource(action, attacker, champ);

    // Apply cooldown
    applyCooldown(action, attacker, champ);
  }

  // Decrement cooldowns by 1 turn for both
  decrementCooldowns(state.player);
  decrementCooldowns(state.enemy);

  // Apply passive energy recovery (simplified: +30 per turn base)
  recoverResource(state.player, champ);
  recoverResource(state.enemy, champ);

  // Update distance and blocked
  if (llmResult.distance != null) state.distance = Math.max(0, llmResult.distance);
  if (llmResult.blocked != null) state.blocked = llmResult.blocked;

  // Apply CS
  if (llmResult.cs) {
    state.player.cs += (llmResult.cs.player || 0);
    state.enemy.cs += (llmResult.cs.enemy || 0);
    // Gold from CS (avg ~20g per CS)
    state.player.gold += (llmResult.cs.player || 0) * 20;
    state.enemy.gold += (llmResult.cs.enemy || 0) * 20;
  }

  // Update minions
  if (llmResult.minions) {
    state.minions = llmResult.minions;
  }

  // Turn increment
  state.turn++;

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

  // Only set cooldown on final cast (recast phase 2, or non-recast)
  const isRecast = skillData.recast;
  const isFinalCast = !isRecast || skill.endsWith('2');

  if (isFinalCast) {
    const rank = attacker.skillLevels[key];
    const cd = skillData.cooldown?.[rank - 1] || 0;
    // Convert seconds to turns (rough: 1 turn ≈ 3 seconds)
    attacker.cooldowns[key] = Math.ceil(cd / 3);
  }
}

// Forced cooldown (used on miss — recast doesn't matter)
function applyCooldownForced(action, attacker, champ) {
  const skill = action.skill;
  if (skill === 'AA') return;
  const key = skill.replace(/[12]/, '');
  const skillData = champ.skills[key];
  if (!skillData) return;
  const rank = attacker.skillLevels[key];
  const cd = skillData.cooldown?.[rank - 1] || 0;
  attacker.cooldowns[key] = Math.ceil(cd / 3);
}

function decrementCooldowns(fighter) {
  for (const key of Object.keys(fighter.cooldowns)) {
    fighter.cooldowns[key] = Math.max(0, fighter.cooldowns[key] - 1);
  }
  for (let i = 0; i < fighter.spellCooldowns.length; i++) {
    fighter.spellCooldowns[i] = Math.max(0, fighter.spellCooldowns[i] - 1);
  }
}

function recoverResource(fighter, champ) {
  if (champ.resource === 'energy') {
    // Energy recovers 50/sec, ~150 per turn (3 sec)
    fighter.resource = Math.min(fighter.maxResource, fighter.resource + 50);
  }
}
