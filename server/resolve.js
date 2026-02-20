// Server-side resolution: validate LLM output + apply exact damage/state changes
import {
  calcQ1Damage, calcQ2Damage, calcE1Damage, calcRDamage, calcAADamage,
  applyDamage, applyShield, setCooldown, spendEnergy, tickEnergy,
  tickCooldowns, restoreEnergy, grantXp, checkWinner, clientState,
} from './game.js';
import { LEE_SIN } from './champions.js';

// Apply LLM resolution to game state, enforce rules
export function resolveTurn(game, llmResult) {
  const { playerAction, aiAction, resolution } = llmResult;
  game.turn++;

  // ── Tick cooldowns & energy regen for both ──
  tickCooldowns(game.player);
  tickCooldowns(game.enemy);
  tickEnergy(game.player);
  tickEnergy(game.enemy);

  // ── Apply position changes ──
  if (resolution.positionChange) {
    const pc = resolution.positionChange;
    game.player.x = clamp(game.player.x + (pc.player?.x || 0), 0, 60);
    game.player.y = clamp(game.player.y + (pc.player?.y || 0), 0, 24);
    game.enemy.x = clamp(game.enemy.x + (pc.enemy?.x || 0), 0, 60);
    game.enemy.y = clamp(game.enemy.y + (pc.enemy?.y || 0), 0, 24);
  }

  // Bush detection
  game.player.inBush = isBush(game.player.x, game.player.y);
  game.enemy.inBush = isBush(game.enemy.x, game.enemy.y);

  // ── Process player hits ──
  const dmgLog = { playerDealt: 0, enemyDealt: 0 };

  for (const hit of (resolution.playerHits || [])) {
    if (!hit.hit) continue;
    const dmg = calcHitDamage(hit.skill, game.player, game.enemy);
    if (dmg > 0) {
      // Validate: can player use this skill?
      if (!validateSkillUse(game.player, hit.skill, game.enemy)) continue;
      consumeSkillResources(game.player, hit.skill);
      const result = applyDamage(game.enemy, dmg);
      dmgLog.playerDealt += dmg;
    }
  }

  // ── Process AI hits ──
  for (const hit of (resolution.aiHits || [])) {
    if (!hit.hit) continue;
    const dmg = calcHitDamage(hit.skill, game.enemy, game.player);
    if (dmg > 0) {
      if (!validateSkillUse(game.enemy, hit.skill, game.player)) continue;
      consumeSkillResources(game.enemy, hit.skill);
      const result = applyDamage(game.player, dmg);
      dmgLog.enemyDealt += dmg;
    }
  }

  // ── Process special actions ──
  // Player shield (W1_SELF)
  if (playerAction.type === 'W1_SELF' && game.player.skillLevels.W > 0) {
    if (spendEnergy(game.player, 50)) {
      applyShield(game.player);
      setCooldown(game.player, 'W');
    }
  }
  // AI shield
  if (aiAction.type === 'W1_SELF' && game.enemy.skillLevels.W > 0) {
    if (spendEnergy(game.enemy, 50)) {
      applyShield(game.enemy);
      setCooldown(game.enemy, 'W');
    }
  }

  // Potion
  if (playerAction.type === 'POTION' && game.player.potions > 0 && !game.player.potionActive) {
    game.player.potions--;
    game.player.potionActive = true;
    game.player.potionTimer = 5;
    game.player.potionHpLeft = 120;
  }
  if (aiAction.type === 'POTION' && game.enemy.potions > 0 && !game.enemy.potionActive) {
    game.enemy.potions--;
    game.enemy.potionActive = true;
    game.enemy.potionTimer = 5;
    game.enemy.potionHpLeft = 120;
  }

  // ── CS ──
  const pCs = resolution.playerCs || 0;
  const aCs = resolution.aiCs || 0;
  game.player.cs += pCs;
  game.enemy.cs += aCs;
  // Gold: mix of melee (21g) and ranged (14g), average ~17.5g per cs
  game.player.gold += pCs * 18;
  game.enemy.gold += aCs * 18;
  // XP from CS
  if (pCs > 0) grantXp(game.player, pCs * 45); // ~avg xp per minion
  if (aCs > 0) grantXp(game.enemy, aCs * 45);
  // Passive XP from nearby minion deaths (both get some even without last hit)
  grantXp(game.player, 30);
  grantXp(game.enemy, 30);

  // ── Minion wave management ──
  game.minionTimer++;
  if (game.minionTimer >= 10) {
    game.minionTimer = 0;
    game.minionWave++;
    game.minions.player = { melee: 3, ranged: 3 };
    game.minions.enemy = { melee: 3, ranged: 3 };
  }

  // ── Check win conditions ──
  const winner = checkWinner(game);
  if (winner) {
    game.winner = winner;
    game.phase = 'gameover';
  }

  // ── Check level up ──
  const needsSkillUp = game.player.skillPoints > 0;
  if (needsSkillUp && game.phase !== 'gameover') {
    game.phase = 'skillup';
  }

  // AI auto-levels skills
  autoLevelAI(game.enemy);

  return {
    dmgLog,
    state: clientState(game),
  };
}

// ── Helpers ──

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function isBush(x, y) {
  return (x >= 18 && x <= 42) && ((y >= 2 && y <= 5) || (y >= 19 && y <= 22));
}

function calcHitDamage(skill, attacker, defender) {
  switch (skill) {
    case 'Q1': return calcQ1Damage(attacker, defender);
    case 'Q2': return calcQ2Damage(attacker, defender);
    case 'E1': return calcE1Damage(attacker, defender);
    case 'R':  return calcRDamage(attacker, defender);
    case 'AA': return calcAADamage(attacker, defender);
    default: return 0;
  }
}

function validateSkillUse(fighter, skill, target) {
  const dist = Math.abs(fighter.x - target.x);
  switch (skill) {
    case 'Q1':
      return fighter.skillLevels.Q > 0 && fighter.cooldowns.Q === 0 && fighter.energy >= 50 && dist <= 24;
    case 'Q2':
      return fighter.skillLevels.Q > 0 && fighter.marks.q > 0 && fighter.energy >= 25;
    case 'E1':
      return fighter.skillLevels.E > 0 && fighter.cooldowns.E === 0 && fighter.energy >= 50 && dist <= 9;
    case 'R':
      return fighter.skillLevels.R > 0 && fighter.cooldowns.R === 0 && dist <= 8;
    case 'AA':
      return dist <= 3;
    default:
      return true;
  }
}

function consumeSkillResources(fighter, skill) {
  switch (skill) {
    case 'Q1':
      spendEnergy(fighter, 50);
      setCooldown(fighter, 'Q');
      break;
    case 'Q2':
      spendEnergy(fighter, 25);
      // Q2 doesn't reset cooldown separately (same as Q1 cd)
      break;
    case 'E1':
      spendEnergy(fighter, 50);
      setCooldown(fighter, 'E');
      break;
    case 'R':
      setCooldown(fighter, 'R');
      break;
    // AA: no resource cost
  }
}

function autoLevelAI(enemy) {
  while (enemy.skillPoints > 0) {
    // Priority: R > Q > E > W
    if (enemy.skillLevels.R < 3 && [6, 11, 16].includes(enemy.level) && enemy.skillLevels.R < Math.floor((enemy.level - 1) / 5)) {
      enemy.skillLevels.R++;
    } else if (enemy.skillLevels.Q < 5) {
      enemy.skillLevels.Q++;
    } else if (enemy.skillLevels.E < 5) {
      enemy.skillLevels.E++;
    } else if (enemy.skillLevels.W < 5) {
      enemy.skillLevels.W++;
    }
    enemy.skillPoints--;
    if (enemy.level >= 6 && enemy.cooldowns.R === 99) {
      enemy.cooldowns.R = 0;
    }
  }
}
