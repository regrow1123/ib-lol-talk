// Game state management, turn processing
import { getStatsAtLevel, LEE_SIN } from './champion.js';
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
    position,
    level: 1, xp: 0,
    cs: 0, gold: 500 - 450 - 50, // after buying doran + pot
    cooldowns: { Q: 0, W: 0, E: 0, R: 37 },
    potions: 1,
    potionActive: 0,
    shield: 0, shieldDuration: 0,
    passiveStacks: 0,
    q1Hit: false, e1Hit: false, w1Used: false,
    lifestealBuff: 0,
    slowed: 0,
    inBush: false,
    items: ['doransBlade'],
  };
}

export function createGameState() {
  return {
    turn: 1,
    player: createFighter('나', 1),
    enemy: createFighter('적', 3),
    minions: initMinions(),
    log: [],
    phase: 'choice', // 'choice' | 'result' | 'gameover'
    winner: null,
    narratives: [],
  };
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
  state.phase = 'choice';
  return state;
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
