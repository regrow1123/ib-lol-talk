// Game state management, turn processing
import { getStatsAtLevel, LEE_SIN, checkLevelUp, MINION_XP } from './champion.js';
import { initMinions, tickMinions, hasLastHittable } from './minions.js';
import { generateActions, resolveActions } from './actions.js';
import { chooseAction } from './ai.js';
import * as templates from './templates.js';

export function createFighter(name, position) {
  const stats = getStatsAtLevel(1, { doransBlade: true });
  return {
    name,
    hp: stats.maxHp, maxHp: stats.maxHp,
    energy: stats.energy, maxEnergy: stats.energy,
    totalAd: stats.totalAd, baseAd: stats.baseAd, bonusAd: stats.bonusAd,
    armor: stats.armor, mr: stats.mr,
    position,       // 0-4 horizontal (tower to tower)
    laneY: 1,       // 0=top, 1=center, 2=bottom (vertical lane position)
    level: 1, xp: 0,
    cs: 0, gold: 500 - 450 - 50, // after buying doran + pot
    cooldowns: { Q: 0, W: 0, E: 0, R: 99 },
    skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 1, // start with 1 point at level 1
    potions: 1,
    potionActive: 0,
    shield: 0, shieldDuration: 0,
    passiveStacks: 0,
    q1Hit: false, e1Hit: false, w1Used: false,
    lifestealBuff: 0,
    slowed: 0,
    items: ['doransBlade'],
  };
}

export function createGameState() {
  const state = {
    turn: 1,
    player: createFighter('나', 1),
    enemy: createFighter('적', 3),
    minions: initMinions(),
    log: [],
    phase: 'skillup', // 'skillup' | 'choice' | 'result' | 'gameover'
    winner: null,
    narratives: [],
  };
  // AI levels up Q at level 1
  state.enemy.skillLevels.Q = 1;
  state.enemy.skillPoints = 0;
  return state;
}

export function getPlayerActions(state) {
  return generateActions(state.player, state.enemy, state.minions, state.minions.playerWave);
}

export function getEnemyActions(state) {
  return generateActions(state.enemy, state.player, state.minions, state.minions.enemyWave);
}

export function processTurn(state, playerAction) {
  // AI chooses
  const enemyActions = getEnemyActions(state);
  const enemyAction = chooseAction(enemyActions, state.enemy, state.player);

  // Resolve
  const results = resolveActions(playerAction, enemyAction, state.player, state.enemy, state.minions);

  // Tick buffs/debuffs
  tickBuffs(state.player);
  tickBuffs(state.enemy);

  // Tick cooldowns
  tickCooldowns(state.player);
  tickCooldowns(state.enemy);

  // Energy regen (50 per 5s = ~17 per turn)
  state.player.energy = Math.min(state.player.maxEnergy, state.player.energy + 17);
  state.enemy.energy = Math.min(state.enemy.maxEnergy, state.enemy.energy + 17);

  // Potion healing
  if (state.player.potionActive > 0) {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 24); // 120/5
    state.player.potionActive--;
  }
  if (state.enemy.potionActive > 0) {
    state.enemy.hp = Math.min(state.enemy.maxHp, state.enemy.hp + 24);
    state.enemy.potionActive--;
  }

  // Tick minions
  tickMinions(state.minions);

  // Build narratives
  state.narratives = results.narratives;
  state.lastPlayerAction = playerAction;
  state.lastEnemyAction = enemyAction;

  // XP from proximity (both get XP from nearby dying minions each turn)
  const deadPlayerMinions = state.minions.playerWave.filter(m => m.hp <= 0).length;
  const deadEnemyMinions = state.minions.enemyWave.filter(m => m.hp <= 0).length;
  // Both players get proximity XP from minions dying near them
  state.player.xp += deadPlayerMinions * 45; // simplified average
  state.enemy.xp += deadEnemyMinions * 45;

  // Level up check
  const playerLeveled = checkLevelUp(state.player);
  const enemyLeveled = checkLevelUp(state.enemy);
  if (playerLeveled) {
    state.narratives.push(`⬆️ 레벨 업! Lv.${state.player.level}`);
  }
  if (enemyLeveled) {
    state.narratives.push(`적이 레벨 업! Lv.${state.enemy.level}`);
    // AI auto level-up skill
    aiLevelUpSkill(state.enemy);
  }

  // Check game over
  if (state.player.hp <= 0) {
    state.phase = 'gameover';
    state.winner = 'enemy';
    state.narratives.push(templates.getKillNarrative('적', '나'));
  } else if (state.enemy.hp <= 0) {
    state.phase = 'gameover';
    state.winner = 'player';
    state.narratives.push(templates.getKillNarrative('나', '적'));
  } else if (state.player.cs >= 100) {
    state.phase = 'gameover';
    state.winner = 'player';
    state.narratives.push('🏆 CS 100 달성! 승리!');
  } else if (state.enemy.cs >= 100) {
    state.phase = 'gameover';
    state.winner = 'enemy';
    state.narratives.push('💀 적이 CS 100을 먼저 달성했다...');
  } else if (playerLeveled && state.player.skillPoints > 0) {
    state.phase = 'result'; // show result first, then skillup on next advance
    state._pendingSkillUp = true;
  } else {
    state.phase = 'result';
  }

  state.turn++;
  state.log.push({
    turn: state.turn - 1,
    playerAction: playerAction.id,
    enemyAction: enemyAction.id,
    narratives: [...state.narratives],
  });

  return state;
}

export function advanceToChoice(state) {
  // Clear one-turn flags
  state.player.q1Hit = false;
  state.player.e1Hit = false;
  state.player.w1Used = false;
  state.enemy.q1Hit = false;
  state.enemy.e1Hit = false;
  state.enemy.w1Used = false;
  
  if (state._pendingSkillUp || state.player.skillPoints > 0) {
    state._pendingSkillUp = false;
    state.phase = 'skillup';
  } else {
    state.phase = 'choice';
  }
  return state;
}

// AI skill level-up priority: R > Q > E > W
function aiLevelUpSkill(fighter) {
  const { canLevelSkill, levelUpSkill } = require_champion();
  const priority = ['R', 'Q', 'E', 'W'];
  for (const skill of priority) {
    if (canLevelSkillCheck(fighter, skill)) {
      fighter.skillLevels[skill]++;
      fighter.skillPoints--;
      if (fighter.skillPoints <= 0) break;
    }
  }
}

function canLevelSkillCheck(fighter, skill) {
  const MAX = { Q: 5, W: 5, E: 5, R: 3 };
  const R_LEVELS = [6, 11, 16];
  if (fighter.skillLevels[skill] >= MAX[skill]) return false;
  if (fighter.skillPoints <= 0) return false;
  if (skill === 'R') {
    if (!R_LEVELS.includes(fighter.level)) return false;
    const rExpected = R_LEVELS.filter(l => l <= fighter.level).length;
    if (fighter.skillLevels[skill] >= rExpected) return false;
  }
  return true;
}

function require_champion() {
  return { canLevelSkill: canLevelSkillCheck };
}

export function hasSkillPoints(state) {
  return state.player.skillPoints > 0;
}

export function playerLevelUpSkill(state, skill) {
  if (!canLevelSkillCheck(state.player, skill)) return false;
  state.player.skillLevels[skill]++;
  state.player.skillPoints--;
  if (state.player.skillPoints <= 0) {
    state.phase = 'choice';
  }
  return true;
}

function tickBuffs(fighter) {
  if (fighter.shieldDuration > 0) {
    fighter.shieldDuration--;
    if (fighter.shieldDuration <= 0) fighter.shield = 0;
  }
  if (fighter.lifestealBuff > 0) fighter.lifestealBuff--;
  if (fighter.slowed > 0) fighter.slowed--;
}

function tickCooldowns(fighter) {
  for (const key of Object.keys(fighter.cooldowns)) {
    if (fighter.cooldowns[key] > 0) fighter.cooldowns[key]--;
  }
}

export function getSituationText(state) {
  const csable = hasLastHittable(state.minions.playerWave) ? state.minions.playerWave.filter(m => m.hp > 0 && m.hp <= state.player.totalAd).length : 0;
  return templates.getTurnSituation(state.turn, state.player.position, state.enemy.position, csable, state.player, state.enemy, state.minions);
}
