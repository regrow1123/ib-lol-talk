// Action generation + combination result resolution
import { LEE_SIN } from './champion.js';
import * as combat from './combat.js';
import * as templates from './templates.js';
import { hasLastHittable, lastHit } from './minions.js';

const DIRECTIONS = ['center', 'left', 'right', 'back', 'forward'];

// Generate available actions for a fighter
export function generateActions(fighter, opponent, minions, csWave) {
  const actions = [];
  const dist = Math.abs(fighter.position - opponent.position);
  const hasCSMinion = hasLastHittable(csWave);

  // 1. Attack actions with direction (Q1 skillshot)
  if (fighter.skillLevels.Q > 0 && fighter.energy >= 50 && fighter.cooldowns.Q <= 0 && dist <= 2) {
    for (const dir of DIRECTIONS) {
      actions.push({
        id: `Q1_${dir}`,
        type: 'attack', skill: 'Q1', direction: dir,
        text: templates.getAttackChoiceText('Q1', dir),
        microPos: 'center', // attacker stays in place
      });
    }
  }

  // Q2 follow-up if Q1 hit
  if (fighter.q1Hit && fighter.energy >= 25) {
    actions.push({
      id: 'Q2',
      type: 'attack', skill: 'Q2', direction: 'center',
      text: templates.getQ2ChoiceText(),
      microPos: 'forward', // dash to target
    });
  }

  // E1 (AOE - no direction needed, hits adjacent)
  if (fighter.skillLevels.E > 0 && fighter.energy >= 50 && fighter.cooldowns.E <= 0 && dist <= 1) {
    actions.push({
      id: 'E1',
      type: 'attack', skill: 'E1', direction: 'aoe',
      text: templates.getAttackChoiceText('E1', 'center'),
      microPos: 'center',
    });
  }

  // E2 follow-up
  if (fighter.e1Hit && fighter.energy >= 25) {
    actions.push({
      id: 'E2',
      type: 'debuff', skill: 'E2',
      text: templates.getE2ChoiceText(),
      microPos: 'center',
    });
  }

  // AA (targeted melee, no direction — auto-hits if adjacent)
  if (dist <= 1) {
    actions.push({
      id: 'AA',
      type: 'attack', skill: 'AA', direction: 'targeted',
      text: '적에게 기본공격을 한다',
      microPos: 'center',
    });
  }

  // W1 (shield)
  if (fighter.skillLevels.W > 0 && fighter.energy >= 50 && fighter.cooldowns.W <= 0) {
    actions.push({
      id: 'W1',
      type: 'defense', skill: 'W1',
      text: templates.getDefenseChoiceText('W1'),
      microPos: 'center',
    });
  }

  // W2 follow-up
  if (fighter.w1Used && fighter.energy >= 25) {
    actions.push({
      id: 'W2',
      type: 'defense', skill: 'W2',
      text: templates.getW2ChoiceText(),
      microPos: 'center',
    });
  }

  // R (targeted, adjacent, level 6+)
  if (fighter.skillLevels.R > 0 && fighter.cooldowns.R <= 0 && dist <= 1) {
    actions.push({
      id: 'R',
      type: 'attack', skill: 'R', direction: 'targeted',
      text: templates.getAttackChoiceText('R', 'center'),
      microPos: 'center',
    });
  }

  // 2. CS action
  if (hasCSMinion) {
    actions.push({
      id: 'CS',
      type: 'cs',
      text: templates.getCSChoiceText(true),
      microPos: 'center', // stay in place
    });
  } else if (csWave.length > 0) {
    actions.push({
      id: 'CS_WAIT',
      type: 'cs',
      text: templates.getCSChoiceText(false),
      microPos: 'center',
    });
  }

  // 3. Movement actions
  const moveDirs = [];
  if (fighter.position < 4) moveDirs.push('forward');
  if (fighter.position > 0) moveDirs.push('back');
  if (fighter.laneY > 0) moveDirs.push('left');
  if (fighter.laneY < 2) moveDirs.push('right');

  for (const dir of moveDirs) {
    actions.push({
      id: `MV_${dir.toUpperCase()}`,
      type: 'move', direction: dir,
      text: templates.getMoveChoiceText(dir),
      microPos: dir,
    });
  }

  // 4. Potion
  if (fighter.potions > 0 && fighter.hp < fighter.maxHp) {
    actions.push({
      id: 'POTION',
      type: 'defense', skill: 'POTION',
      text: templates.getDefenseChoiceText('POTION'),
      microPos: 'center',
    });
  }

  return actions;
}

// Resolve the combination of two actions
export function resolveActions(playerAction, enemyAction, player, enemy, minions) {
  const results = { player: [], enemy: [], narratives: [] };

  // Determine micro positions
  const playerMicro = playerAction.microPos || 'center';
  const enemyMicro = enemyAction.microPos || 'center';

  // Process player action
  processAction(playerAction, enemyAction, player, enemy, playerMicro, enemyMicro, results, '나', '적', 'player');
  // Process enemy action
  processAction(enemyAction, playerAction, enemy, player, enemyMicro, playerMicro, results, '적', '나', 'enemy');

  return results;
}

function processAction(myAction, theirAction, me, them, myMicro, theirMicro, results, myName, theirName, side) {
  if (myAction.type === 'attack') {
    const hit = checkHit(myAction, theirAction, theirMicro);
    if (hit) {
      const damage = calcActionDamage(myAction, me, them);
      const actualDmg = applyDamage(them, damage.amount, damage.type);
      results.narratives.push(templates.getHitNarrative(myName, myAction.skill, actualDmg, theirName));
      results[side === 'player' ? 'enemy' : 'player'].push({ type: 'damage', amount: actualDmg });

      // Set hit flags for follow-ups
      if (myAction.skill === 'Q1') me.q1Hit = true;
      if (myAction.skill === 'E1') me.e1Hit = true;

      // Energy cost
      applyEnergyCost(me, myAction);
      // Set cooldown
      applyCooldown(me, myAction);
      // Passive trigger
      me.passiveStacks = 2;
    } else {
      const reason = 'dodge';
      results.narratives.push(templates.getMissNarrative(myName, myAction.skill, reason));
      applyEnergyCost(me, myAction);
      applyCooldown(me, myAction);
    }
  } else if (myAction.type === 'cs') {
    // CS: stay in center → vulnerable
    const csWave = side === 'player' ? minions.playerWave : minions.enemyWave;
    if (myAction.id === 'CS') {
      const result = lastHit(csWave);
      if (result.success) {
        me.cs++;
        me.gold += result.gold;
        results.narratives.push(templates.getCSNarrative(myName, result.gold));
      }
    }
    // Passive energy restore from AA on minion
    if (me.passiveStacks > 0) {
      me.energy = Math.min(me.maxEnergy, me.energy + 20);
      me.passiveStacks--;
    }
  } else if (myAction.type === 'move') {
    if (myAction.direction === 'forward' && me.position < 4) me.position++;
    else if (myAction.direction === 'back' && me.position > 0) me.position--;
    else if (myAction.direction === 'left' && me.laneY > 0) me.laneY--;
    else if (myAction.direction === 'right' && me.laneY < 2) me.laneY++;
    results.narratives.push(templates.getMoveNarrative(myName, myAction.direction));
  } else if (myAction.type === 'defense') {
    if (myAction.skill === 'W1') {
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
    } else if (myAction.skill === 'POTION') {
      me.potionActive = 5; // 5 turns
      me.potions--;
    }
  } else if (myAction.type === 'debuff') {
    if (myAction.skill === 'E2') {
      them.slowed = 2;
      applyEnergyCost(me, myAction);
      me.passiveStacks = 2;
    }
  }
}

function checkHit(attackAction, defenseAction, defenderMicro) {
  const skill = attackAction.skill;

  // Targeted skills (AA, R): only flash dodges
  if (skill === 'AA' || skill === 'R' || skill === 'Q2') {
    if (defenseAction.type === 'move' && defenseAction.direction === 'back') {
      return false; // retreat out of range
    }
    return true; // targeted: hits unless special dodge
  }

  // E1 (AOE): left/right don't dodge, only back/bush
  if (skill === 'E1') {
    if (defenseAction.type === 'move' && defenseAction.direction === 'back') {
      return false;
    }
    return true; // AOE hits
  }

  // Skillshot (Q1): direction prediction
  if (skill === 'Q1') {
    const aimDir = attackAction.direction;
    // Defender's actual position
    let actualPos = 'center';
    if (defenseAction.type === 'move') {
      actualPos = defenseAction.direction;
    } else if (defenseAction.type === 'cs' || defenseAction.type === 'defense') {
      actualPos = 'center'; // staying in place
    } else if (defenseAction.type === 'attack') {
      actualPos = 'center'; // attacking = staying
    }
    return aimDir === actualPos;
  }

  // AA with direction prediction
  if (attackAction.id && attackAction.id.startsWith('AA_')) {
    // AA is targeted but we added direction for mindgame
    // In this prototype, AA is semi-targeted: hits most positions
    return true;
  }

  return true;
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
