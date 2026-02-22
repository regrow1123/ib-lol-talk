import { loadChampion } from './champions.js';

export const ELAPSED_MAP = {
  instant: 1,
  short: 3,
  medium: 6,
  long: 10,
  very_long: 15,
};

/**
 * Main entry point: apply all actions from LLM result to game state.
 * Mutates state in place.
 */
export function applyActions(state, llmResult) {
  const actions = llmResult.actions || [];
  const elapsedKey = ELAPSED_MAP[llmResult.elapsed] ? llmResult.elapsed : 'medium';
  const elapsedSec = ELAPSED_MAP[elapsedKey];

  // 1. Process each action sequentially
  for (const action of actions) {
    processAction(state, action);
  }

  // 2. Decrement cooldowns by elapsed
  decrementCooldowns(state, elapsedSec);

  // 3. Resource recovery
  recoverResource(state, elapsedSec);

  // 4. HP regen
  recoverHp(state, elapsedSec);

  // 5. State updates from LLM
  if (typeof llmResult.distance === 'number') state.distance = llmResult.distance;
  if (typeof llmResult.blocked === 'boolean') state.blocked = llmResult.blocked;

  // CS accumulation (additive, not absolute)
  if (llmResult.cs) {
    if (typeof llmResult.cs.player === 'number') state.player.cs += llmResult.cs.player;
    if (typeof llmResult.cs.enemy === 'number') state.enemy.cs += llmResult.cs.enemy;
  }

  // Minions
  if (llmResult.minions) {
    state.minions = llmResult.minions;
  }

  // 6. Shield decay
  decayShields(state, elapsedSec);
}

function processAction(state, action) {
  const { who, skill, target, hit } = action;
  if (!who || !skill) return;

  const attacker = state[who];
  const defender = target === 'enemy' ? state.enemy : target === 'player' ? state.player : null;
  if (!attacker) return;

  // Parse skill key and phase: "Q1" -> key="Q", phase=0; "Q2" -> key="Q", phase=1
  // "AA" -> auto attack; "R" -> key="R", phase=0
  if (skill === 'AA') {
    if (hit && defender) {
      const rawDmg = attacker.ad;
      applyDamage(defender, rawDmg, 'physical');
    }
    return;
  }

  const { key, phase } = parseSkill(skill);
  if (!key) return;

  // Validate: skill must be learned
  if (!attacker.skillLevels[key] || attacker.skillLevels[key] <= 0) return;

  const champData = loadChampion(attacker.champion);
  const skillData = champData.skills[key];
  if (!skillData) return;

  const rank = attacker.skillLevels[key];

  // Consume resource (on both hit and miss)
  const costPhase = skillData.recast ? phase : 0;
  const cost = skillData.cost[costPhase] || 0;
  attacker.resource -= cost;

  // Set cooldown on first cast only
  if (phase === 0) {
    attacker.cooldowns[key] = skillData.cooldown[rank - 1] || 0;
  }

  if (!hit) return; // Miss: resource consumed, cooldown set, but no effect

  if (!defender) return;

  // Calculate effect
  const effect = calculateSkillEffect(attacker, defender, skillData, key, phase, rank);

  if (effect.shield > 0) {
    // Shield goes on the attacker (self-shield like W1)
    attacker.shields.push({
      amount: effect.shield,
      remaining: skillData.shieldDuration || 2,
      source: skill,
    });
  }

  if (effect.damage > 0) {
    applyDamage(defender, effect.damage, effect.damageType);
  }
}

function parseSkill(skill) {
  // "Q1" -> {key:"Q", phase:0}, "Q2" -> {key:"Q", phase:1}, "R" -> {key:"R", phase:0}
  const match = skill.match(/^([QWER])(\d)?$/);
  if (!match) return { key: null, phase: 0 };
  const key = match[1];
  const num = match[2] ? parseInt(match[2]) : 1;
  return { key, phase: num - 1 };
}

function calculateSkillEffect(attacker, defender, skillData, key, phase, rank) {
  const result = { damage: 0, damageType: 'physical', shield: 0 };

  // Shield (e.g., W1)
  if (skillData.shield && phase === 0) {
    result.shield = skillData.shield[rank - 1] || 0;
  }

  // Damage
  const baseDmgArr = skillData.baseDamage[phase];
  if (!baseDmgArr) return result;

  const baseDmg = baseDmgArr[rank - 1] || 0;
  if (baseDmg === 0 && !skillData.scaling[phase]) return result;

  let totalDmg = baseDmg;

  // Scaling
  const scaling = skillData.scaling[phase];
  if (scaling) {
    const statValue = getStatValue(attacker, scaling.stat);
    totalDmg += statValue * scaling.ratio;
  }

  // Q2 special: missing HP bonus
  if (key === 'Q' && phase === 1) {
    const missingHpRatio = 1 - (defender.hp / defender.maxHp);
    totalDmg *= (1 + missingHpRatio);
  }

  // Apply resistance
  const dmgType = skillData.damageType[phase] || 'physical';
  result.damageType = dmgType;
  result.damage = applyResistance(totalDmg, defender, dmgType);

  return result;
}

function getStatValue(fighter, stat) {
  switch (stat) {
    case 'bonusAD': return fighter.ad - fighter.baseAd; // No items, so always 0 at base
    case 'totalAD': return fighter.ad;
    case 'AP': return 0; // No AP in current design
    default: return 0;
  }
}

function applyResistance(rawDamage, defender, damageType) {
  if (damageType === 'true') return Math.round(rawDamage);
  const resist = damageType === 'magic' ? defender.mr : defender.armor;
  return Math.round(rawDamage * 100 / (100 + resist));
}

function applyDamage(defender, amount, damageType) {
  let remaining = amount;

  // Absorb with shields (oldest first, FIFO)
  for (let i = 0; i < defender.shields.length && remaining > 0; i++) {
    const shield = defender.shields[i];
    if (shield.amount <= remaining) {
      remaining -= shield.amount;
      shield.amount = 0;
    } else {
      shield.amount -= remaining;
      remaining = 0;
    }
  }

  // Remove depleted shields
  defender.shields = defender.shields.filter(s => s.amount > 0);

  // Apply remaining damage to HP
  defender.hp -= remaining;
}

function decrementCooldowns(state, elapsedSec) {
  for (const side of ['player', 'enemy']) {
    const f = state[side];
    for (const key of Object.keys(f.cooldowns)) {
      f.cooldowns[key] = Math.max(0, f.cooldowns[key] - elapsedSec);
    }
    for (let i = 0; i < f.spellCooldowns.length; i++) {
      f.spellCooldowns[i] = Math.max(0, f.spellCooldowns[i] - elapsedSec);
    }
  }
}

function recoverResource(state, elapsedSec) {
  for (const side of ['player', 'enemy']) {
    const f = state[side];
    if (f.resourceType === 'energy') {
      f.resource = Math.min(f.maxResource, f.resource + 50 * elapsedSec);
    }
    // mana recovery can be added here later
  }
}

function recoverHp(state, elapsedSec) {
  for (const side of ['player', 'enemy']) {
    const f = state[side];
    const champ = loadChampion(f.champion);
    const s = champ.baseStats;
    const regen = s.hpRegen + s.hpRegenPerLevel * (f.level - 1);
    f.hp = Math.min(f.maxHp, f.hp + regen * elapsedSec);
  }
}

function decayShields(state, elapsedSec) {
  for (const side of ['player', 'enemy']) {
    const f = state[side];
    for (const shield of f.shields) {
      shield.remaining -= elapsedSec;
    }
    f.shields = f.shields.filter(s => s.remaining > 0);
  }
}
