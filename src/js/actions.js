// Intent-based action generation + combination resolution
import { LEE_SIN } from './champion.js';
import * as combat from './combat.js';
import * as templates from './templates.js';
import { hasLastHittable, lastHit, isBehindMinions, getFrontmostMinionX } from './minions.js';
import { getGridDistance, isInBush, AA_RANGE, E_RANGE, Q_RANGE, R_RANGE, W_RANGE, TOWER_RANGE, BUSH_TOP, BUSH_BOT, LANE_Y_MIN, LANE_Y_MAX } from './engine.js';

// Generate available intent-based actions for a fighter
export function generateActions(fighter, opponent, minions, csWave) {
  const actions = [];
  const distance = getGridDistance(fighter, opponent);
  const hasCSMinion = hasLastHittable(csWave);
  const isPlayerFighter = fighter.name === '나';

  // 1. Attack intents (based on range and availability)
  
  // Q1 (Skillshot) - Range 24 cells
  if (fighter.skillLevels.Q > 0 && fighter.energy >= 50 && fighter.cooldowns.Q <= 0 && distance <= Q_RANGE) {
    actions.push({
      id: 'Q1_CAST',
      type: 'attack', skill: 'Q1', intent: 'Q1_CAST',
      text: templates.getIntentText('Q1_CAST'),
    });
  }

  // Q2 follow-up if Q1 hit
  if (fighter.q1Hit && fighter.energy >= 25) {
    actions.push({
      id: 'Q2_CAST',
      type: 'attack', skill: 'Q2', intent: 'Q2_CAST',
      text: templates.getIntentText('Q2_CAST'),
    });
  }

  // E1 (AOE) - Range 9 cells
  if (fighter.skillLevels.E > 0 && fighter.energy >= 50 && fighter.cooldowns.E <= 0 && distance <= E_RANGE) {
    actions.push({
      id: 'E1_CAST',
      type: 'attack', skill: 'E1', intent: 'E1_CAST',
      text: templates.getIntentText('E1_CAST'),
    });
  }

  // E2 follow-up
  if (fighter.e1Hit && fighter.energy >= 25) {
    actions.push({
      id: 'E2_CAST',
      type: 'debuff', skill: 'E2', intent: 'E2_CAST',
      text: templates.getIntentText('E2_CAST'),
    });
  }

  // AA (Auto attack) - Range 3 cells
  if (distance <= AA_RANGE) {
    actions.push({
      id: 'AA_CHAMP',
      type: 'attack', skill: 'AA', intent: 'AA_CHAMP',
      text: templates.getIntentText('AA_CHAMP'),
    });
  }

  // W1 (Shield/dash)
  if (fighter.skillLevels.W > 0 && fighter.energy >= 50 && fighter.cooldowns.W <= 0) {
    // W1 self shield
    actions.push({
      id: 'W1_SELF',
      type: 'defense', skill: 'W1', intent: 'W1_SELF',
      text: templates.getIntentText('W1_SELF'),
    });
    
    // W1 minion dash (if minions nearby)
    const allyWave = isPlayerFighter ? minions.enemyWave : minions.playerWave;
    const nearbyMinions = allyWave.filter(m => m.hp > 0 && getGridDistance(fighter, m) <= W_RANGE);
    if (nearbyMinions.length > 0) {
      actions.push({
        id: 'W1_MINION',
        type: 'utility', skill: 'W1', intent: 'W1_MINION',
        text: templates.getIntentText('W1_MINION'),
      });
    }
  }

  // W2 follow-up
  if (fighter.w1Used && fighter.energy >= 25) {
    actions.push({
      id: 'W2_CAST',
      type: 'defense', skill: 'W2', intent: 'W2_CAST',
      text: templates.getIntentText('W2_CAST'),
    });
  }

  // R (Ultimate) - Range 8 cells
  if (fighter.skillLevels.R > 0 && fighter.cooldowns.R <= 0 && distance <= R_RANGE) {
    actions.push({
      id: 'R_CAST',
      type: 'attack', skill: 'R', intent: 'R_CAST',
      text: templates.getIntentText('R_CAST'),
    });
  }

  // 2. Positioning intents

  // PRESS - Move closer to enemy for aggression
  if (distance > AA_RANGE) {
    actions.push({
      id: 'PRESS',
      type: 'positioning', intent: 'PRESS',
      text: templates.getIntentText('PRESS'),
    });
  }

  // RETREAT - Move back toward tower
  const ownTowerX = isPlayerFighter ? 3 : 57;
  if (Math.abs(fighter.x - ownTowerX) > 5) {
    actions.push({
      id: 'RETREAT',
      type: 'positioning', intent: 'RETREAT',
      text: templates.getIntentText('RETREAT'),
    });
  }

  // ALL_IN - Dash to enemy
  if (distance > AA_RANGE) {
    actions.push({
      id: 'ALL_IN',
      type: 'positioning', intent: 'ALL_IN',
      text: templates.getIntentText('ALL_IN'),
    });
  }

  // MV_DODGE - Evasive movement
  if (fighter.y >= LANE_Y_MIN + 2 && fighter.y <= LANE_Y_MAX - 2) {
    actions.push({
      id: 'MV_DODGE',
      type: 'positioning', intent: 'MV_DODGE',
      text: templates.getIntentText('MV_DODGE'),
    });
  }

  // BUSH intents
  const nearTopBush = fighter.x >= BUSH_TOP.xMin - 5 && fighter.x <= BUSH_TOP.xMax + 5;
  const nearBotBush = fighter.x >= BUSH_BOT.xMin - 5 && fighter.x <= BUSH_BOT.xMax + 5;
  const inBush = isInBush(fighter.x, fighter.y);
  
  if (!inBush && (nearTopBush || nearBotBush)) {
    actions.push({
      id: 'BUSH_IN',
      type: 'positioning', intent: 'BUSH_IN',
      text: templates.getIntentText('BUSH_IN'),
    });
  }
  
  if (inBush) {
    actions.push({
      id: 'BUSH_OUT',
      type: 'positioning', intent: 'BUSH_OUT',
      text: templates.getIntentText('BUSH_OUT'),
    });
  }

  // 3. CS intents
  if (hasCSMinion) {
    // CS_SAFE - CS from behind minions
    if (isBehindMinions(fighter, minions, isPlayerFighter)) {
      actions.push({
        id: 'CS_SAFE',
        type: 'cs', intent: 'CS_SAFE',
        text: templates.getIntentText('CS_SAFE'),
      });
    }
    
    // CS_PUSH - Aggressive CS
    actions.push({
      id: 'CS_PUSH',
      type: 'cs', intent: 'CS_PUSH',
      text: templates.getIntentText('CS_PUSH'),
    });
  }

  // 4. Special intents
  
  // FLASH
  // TODO: Add flash logic when implemented
  
  // IGNITE
  // TODO: Add ignite logic when implemented
  
  // POTION
  if (fighter.potions > 0 && fighter.hp < fighter.maxHp) {
    actions.push({
      id: 'POTION',
      type: 'utility', intent: 'POTION',
      text: templates.getIntentText('POTION'),
    });
  }

  // RECALL
  const nearOwnTower = Math.abs(fighter.x - ownTowerX) <= 5;
  if (nearOwnTower) {
    actions.push({
      id: 'RECALL',
      type: 'utility', intent: 'RECALL',
      text: templates.getIntentText('RECALL'),
    });
  }

  return actions;
}

// Resolve the combination of two intents
export function resolveActions(playerAction, enemyAction, player, enemy, minions) {
  const results = { player: [], enemy: [], narratives: [] };

  // Process positioning changes first (movement intents)
  applyPositioning(playerAction, player, enemy, minions, true);
  applyPositioning(enemyAction, enemy, player, minions, false);

  // Process actions with combination table
  processIntentCombination(playerAction, enemyAction, player, enemy, minions, results, '나', '적', 'player');
  processIntentCombination(enemyAction, playerAction, enemy, player, minions, results, '적', '나', 'enemy');

  return results;
}

// Apply positioning changes based on intent
function applyPositioning(action, fighter, opponent, minions, isPlayer) {
  const intent = action.intent;
  
  switch (intent) {
    case 'PRESS':
      // Move closer to opponent (but not into AA range)
      const targetDistance = AA_RANGE + 1;
      if (fighter.x < opponent.x) {
        fighter.x = Math.min(opponent.x - targetDistance, fighter.x + 8);
      } else {
        fighter.x = Math.max(opponent.x + targetDistance, fighter.x - 8);
      }
      break;
      
    case 'RETREAT':
      // Move toward own tower
      const ownTowerX = isPlayer ? 3 : 57;
      const retreatDistance = 15;
      if (fighter.x < ownTowerX) {
        fighter.x = Math.max(0, fighter.x - retreatDistance);
      } else {
        fighter.x = Math.min(60, fighter.x + (ownTowerX - fighter.x > 0 ? retreatDistance : -retreatDistance));
      }
      break;
      
    case 'ALL_IN':
      // Move to AA range of opponent
      if (fighter.x < opponent.x) {
        fighter.x = Math.max(fighter.x, opponent.x - AA_RANGE);
      } else {
        fighter.x = Math.min(fighter.x, opponent.x + AA_RANGE);
      }
      break;
      
    case 'MV_DODGE':
      // Move to different Y position
      const dodgeOptions = [];
      if (fighter.y > LANE_Y_MIN) dodgeOptions.push(fighter.y - 3);
      if (fighter.y < LANE_Y_MAX) dodgeOptions.push(fighter.y + 3);
      if (dodgeOptions.length > 0) {
        fighter.y = dodgeOptions[Math.floor(Math.random() * dodgeOptions.length)];
      }
      break;
      
    case 'BUSH_IN':
      // Move to nearest bush
      const bushY = fighter.y < 12 ? Math.floor((BUSH_TOP.yMin + BUSH_TOP.yMax) / 2) : Math.floor((BUSH_BOT.yMin + BUSH_BOT.yMax) / 2);
      const bushX = Math.max(BUSH_TOP.xMin, Math.min(BUSH_TOP.xMax, fighter.x));
      fighter.x = bushX;
      fighter.y = bushY;
      break;
      
    case 'BUSH_OUT':
      // Move to lane
      fighter.y = 12; // Center of lane
      break;
      
    case 'Q2_CAST':
      // Dash to opponent (Q2 always hits and moves)
      fighter.x = opponent.x + (fighter.x < opponent.x ? -AA_RANGE : AA_RANGE);
      break;
      
    case 'W1_MINION':
      // Dash to nearby minion
      const allyWave = isPlayer ? minions.enemyWave : minions.playerWave;
      const nearbyMinions = allyWave.filter(m => m.hp > 0 && getGridDistance(fighter, m) <= W_RANGE);
      if (nearbyMinions.length > 0) {
        const target = nearbyMinions[0];
        fighter.x = target.x;
        fighter.y = target.y;
      }
      break;
  }
  
  // Clamp positions to grid bounds
  fighter.x = Math.max(0, Math.min(60, fighter.x));
  fighter.y = Math.max(0, Math.min(24, fighter.y));
}

// Process intent combination based on combination table
function processIntentCombination(myAction, theirAction, me, them, minions, results, myName, theirName, side) {
  const myIntent = myAction.intent;
  const theirIntent = theirAction.intent;
  const isPlayer = side === 'player';

  // Handle attack intents
  if (myAction.type === 'attack') {
    const hit = checkIntentHit(myIntent, theirIntent, me, them, minions, isPlayer);
    
    if (hit) {
      const damage = calcActionDamage(myAction, me, them);
      const actualDmg = applyDamage(them, damage.amount, damage.type);
      results.narratives.push(templates.getHitNarrative(myName, myAction.skill, actualDmg, theirName));
      results[side === 'player' ? 'enemy' : 'player'].push({ type: 'damage', amount: actualDmg });

      // Set hit flags for follow-ups
      if (myAction.skill === 'Q1') me.q1Hit = true;
      if (myAction.skill === 'E1') me.e1Hit = true;

      // Energy cost & cooldown
      applyEnergyCost(me, myAction);
      applyCooldown(me, myAction);
      // Passive trigger
      me.passiveStacks = 2;
    } else {
      results.narratives.push(templates.getMissNarrative(myName, myAction.skill, 'dodge'));
      applyEnergyCost(me, myAction);
      applyCooldown(me, myAction);
    }
  }
  
  // Handle CS intents
  else if (myAction.type === 'cs') {
    const csWave = isPlayer ? minions.playerWave : minions.enemyWave;
    const result = lastHit(csWave, me.totalAd);
    if (result.success) {
      me.cs++;
      me.gold += result.gold;
      me.xp += result.xp || 0;
      results.narratives.push(templates.getCSNarrative(myName, result.gold));
    }
    
    // Passive energy restore
    if (me.passiveStacks > 0) {
      me.energy = Math.min(me.maxEnergy, me.energy + 20);
      me.passiveStacks--;
    }
  }
  
  // Handle defense/utility intents
  else if (myAction.type === 'defense' || myAction.type === 'utility') {
    if (myAction.skill === 'W1' && myIntent === 'W1_SELF') {
      const shield = combat.calcW1Shield(me);
      me.shield = shield;
      me.shieldDuration = 1;
      me.w1Used = true;
      applyEnergyCost(me, myAction);
      applyCooldown(me, myAction);
      me.passiveStacks = 2;
      results.narratives.push(templates.getShieldNarrative(myName, shield));
    } else if (myAction.skill === 'W2') {
      me.lifestealBuff = 2;
      applyEnergyCost(me, myAction);
      me.passiveStacks = 2;
    } else if (myAction.intent === 'POTION') {
      me.potionActive = 5; // 5 turns
      me.potions--;
      results.narratives.push(`${myName}이(가) 포션을 마셨다`);
    }
  }
  
  // Handle debuff intents
  else if (myAction.type === 'debuff') {
    if (myAction.skill === 'E2') {
      them.slowed = 2;
      applyEnergyCost(me, myAction);
      me.passiveStacks = 2;
      results.narratives.push(`${myName}이(가) ${theirName}을(를) 둔화시켰다`);
    }
  }
  
  // Handle positioning intents (already applied, just add narrative)
  else if (myAction.type === 'positioning') {
    results.narratives.push(templates.getPositioningNarrative(myName, myIntent));
  }
}

// Check hit based on intent combination table
function checkIntentHit(attackIntent, defendIntent, attacker, defender, minions, isPlayerAttacker) {
  const distance = getGridDistance(attacker, defender);
  
  switch (attackIntent) {
    case 'Q1_CAST': // Skillshot
      // Blocked by minions if defender is CS_SAFE or CS_PUSH
      if (defendIntent === 'CS_SAFE' || defendIntent === 'CS_PUSH') {
        return false; // Minions block
      }
      // Hits if defender is PRESS, ALL_IN, AA_CHAMP, or other attacking
      if (['PRESS', 'ALL_IN', 'AA_CHAMP', 'Q1_CAST', 'E1_CAST', 'R_CAST'].includes(defendIntent)) {
        return true; // Position fixed during attack
      }
      // Misses if MV_DODGE, BUSH_IN, W1_MINION, RETREAT (if out of range)
      if (['MV_DODGE', 'BUSH_IN', 'W1_MINION'].includes(defendIntent)) {
        return false; // Evasive movement
      }
      if (defendIntent === 'RETREAT') {
        return distance <= Q_RANGE; // Only hits if still in range after retreat
      }
      return true; // Default hit for other intents
      
    case 'E1_CAST': // AOE
      // Hits if in range and not evasive
      if (distance > E_RANGE) return false;
      if (['BUSH_IN', 'W1_MINION'].includes(defendIntent)) {
        return false; // Out of range escape
      }
      if (defendIntent === 'MV_DODGE') {
        return distance <= E_RANGE / 2; // May still be in AOE range
      }
      if (defendIntent === 'RETREAT') {
        return distance <= E_RANGE; // May escape if on the edge
      }
      return true; // AOE hits most things in range
      
    case 'AA_CHAMP':
    case 'R_CAST': // Targeted
      if (distance > (attackIntent === 'AA_CHAMP' ? AA_RANGE : R_RANGE)) return false;
      // Only specific evasive moves dodge targeted abilities
      if (['RETREAT', 'BUSH_IN', 'W1_MINION'].includes(defendIntent)) {
        return false; // Out of range/sight
      }
      return true; // Targeted abilities hit unless specifically dodged
      
    default:
      return true;
  }
}

function calcActionDamage(action, attacker, target) {
  switch (action.skill) {
    case 'Q1': return { amount: combat.calcQ1Damage(attacker, target), type: 'physical' };
    case 'Q2': return { amount: combat.calcQ2Damage(attacker, target), type: 'physical' };
    case 'E1': return { amount: combat.calcE1Damage(attacker, target), type: 'magic' };
    case 'R': return { amount: combat.calcRDamage(attacker, target), type: 'physical' };
    case 'AA': return { amount: combat.calcAutoAttackDamage(attacker, target), type: 'physical' };
    default: return { amount: 0, type: 'physical' };
  }
}

function applyDamage(target, amount, type) {
  let actualDmg = amount;
  // Shield absorbs first
  if (target.shield > 0) {
    if (target.shield >= actualDmg) {
      target.shield -= actualDmg;
      return 0;
    } else {
      actualDmg -= target.shield;
      target.shield = 0;
    }
  }
  target.hp = Math.max(0, target.hp - actualDmg);
  return Math.round(actualDmg * 10) / 10;
}

function applyEnergyCost(fighter, action) {
  const skill = action.skill;
  const costs = { Q1: 50, Q2: 25, W1: 50, W2: 25, E1: 50, E2: 25 };
  fighter.energy = Math.max(0, fighter.energy - (costs[skill] || 0));
}

function applyCooldown(fighter, action) {
  const skill = action.skill;
  const cdMap = { Q1: 4, W1: 4, E1: 3, R: 37 };
  const baseSkill = skill.replace(/[12]/, '');
  if (cdMap[skill]) {
    fighter.cooldowns[baseSkill] = cdMap[skill];
  }
}