// Game state management + damage calculations
import { LEE_SIN } from './champions.js';
import { randomUUID } from 'crypto';

// ── Create new game state ──
export function createGame(difficulty = 'normal') {
  const mkFighter = () => {
    const b = LEE_SIN.base;
    const doran = LEE_SIN.startItems.doranBlade;
    return {
      champion: 'LeeSin',
      level: 1,
      hp: b.hp,
      maxHp: b.hp,
      energy: b.energy,
      maxEnergy: b.energy,
      ad: b.ad + doran.ad,
      bonusAd: doran.ad,
      armor: b.armor,
      mr: b.mr,
      cs: 0,
      gold: 0,  // spent starting gold already
      xp: 0,
      shield: 0,
      shieldTimer: 0,
      skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
      skillPoints: 1,
      cooldowns: { Q: 0, W: 0, E: 0, R: 99 },  // R locked until 6
      marks: { q: 0, e: 0 },  // remaining turns for Q/E mark
      buffs: [],
      potions: 1,
      potionActive: false,
      potionTimer: 0,
      potionHpLeft: 0,
      recallUsed: false,
      flashCooldown: 0,  // in turns
      igniteCooldown: 0,
      // Grid position (internal, server only)
      x: 15, y: 12,
      inBush: false,
    };
  };

  return {
    id: randomUUID(),
    turn: 0,
    phase: 'skillup',  // skillup -> play -> gameover
    difficulty,
    player: mkFighter(),
    enemy: { ...mkFighter(), skillPoints: 0, skillLevels: { Q: 1, W: 0, E: 0, R: 0 }, x: 45 },
    minionWave: 1,
    minionTimer: 0,
    // Minion state (simplified): count of alive minions per side
    minions: {
      player: { melee: 3, ranged: 3 },
      enemy: { melee: 3, ranged: 3 },
    },
    winner: null,
    log: [],
  };
}

// ── Damage formulas (exact LoL) ──
export function calcPhysicalDmg(rawDmg, targetArmor) {
  if (targetArmor >= 0) {
    return rawDmg * 100 / (100 + targetArmor);
  }
  return rawDmg * (2 - 100 / (100 - targetArmor));
}

export function calcMagicDmg(rawDmg, targetMr) {
  if (targetMr >= 0) {
    return rawDmg * 100 / (100 + targetMr);
  }
  return rawDmg * (2 - 100 / (100 - targetMr));
}

// ── Skill damage calculations ──
export function calcQ1Damage(attacker, defender) {
  const rank = attacker.skillLevels.Q;
  if (rank === 0) return 0;
  const data = LEE_SIN.skills.Q;
  const raw = data.q1Base[rank - 1] + data.q1BonusAdRatio * attacker.bonusAd;
  return calcPhysicalDmg(raw, defender.armor);
}

export function calcQ2Damage(attacker, defender) {
  const rank = attacker.skillLevels.Q;
  if (rank === 0) return 0;
  const data = LEE_SIN.skills.Q;
  const missingHpRatio = 1 - (defender.hp / defender.maxHp);
  const base = data.q2Base[rank - 1] + data.q2BonusAdRatio * attacker.bonusAd;
  const maxBase = data.q2MaxBase[rank - 1] + data.q2MaxBonusAdRatio * attacker.bonusAd;
  const raw = base + (maxBase - base) * missingHpRatio;
  return calcPhysicalDmg(raw, defender.armor);
}

export function calcE1Damage(attacker, defender) {
  const rank = attacker.skillLevels.E;
  if (rank === 0) return 0;
  const data = LEE_SIN.skills.E;
  const raw = data.e1Base[rank - 1] + data.e1TotalAdRatio * attacker.ad;
  return calcMagicDmg(raw, defender.mr);
}

export function calcRDamage(attacker, defender) {
  const rank = attacker.skillLevels.R;
  if (rank === 0) return 0;
  const data = LEE_SIN.skills.R;
  const raw = data.base[rank - 1] + data.bonusAdRatio * attacker.bonusAd;
  return calcPhysicalDmg(raw, defender.armor);
}

export function calcAADamage(attacker, defender) {
  return calcPhysicalDmg(attacker.ad, defender.armor);
}

// ── Apply damage (handles shield) ──
export function applyDamage(target, amount) {
  let remaining = amount;
  if (target.shield > 0) {
    if (target.shield >= remaining) {
      target.shield -= remaining;
      return { absorbed: remaining, hpLost: 0 };
    }
    remaining -= target.shield;
    const absorbed = target.shield;
    target.shield = 0;
    target.hp = Math.max(0, target.hp - remaining);
    return { absorbed, hpLost: remaining };
  }
  target.hp = Math.max(0, target.hp - remaining);
  return { absorbed: 0, hpLost: remaining };
}

// ── Level up stats ──
export function applyLevelUp(fighter) {
  const b = LEE_SIN.base;
  fighter.level++;
  fighter.maxHp = b.hp + b.hpPerLevel * (fighter.level - 1);
  fighter.hp += b.hpPerLevel; // heal by growth amount
  fighter.ad = b.ad + b.adPerLevel * (fighter.level - 1) + fighter.bonusAd;
  fighter.armor = b.armor + b.armorPerLevel * (fighter.level - 1);
  fighter.mr = b.mr + b.mrPerLevel * (fighter.level - 1);
  fighter.skillPoints++;
  // Unlock R at level 6
  if (fighter.level >= 6 && fighter.cooldowns.R === 99) {
    fighter.cooldowns.R = 0;
  }
}

// ── Cooldown tick (1 turn = ~3 seconds) ──
export function tickCooldowns(fighter) {
  for (const s of ['Q', 'W', 'E', 'R']) {
    if (fighter.cooldowns[s] > 0 && fighter.cooldowns[s] < 99) {
      fighter.cooldowns[s] = Math.max(0, fighter.cooldowns[s] - 1);
    }
  }
  // Marks decay
  if (fighter.marks.q > 0) fighter.marks.q--;
  if (fighter.marks.e > 0) fighter.marks.e--;
  // Shield decay
  if (fighter.shieldTimer > 0) {
    fighter.shieldTimer--;
    if (fighter.shieldTimer <= 0) fighter.shield = 0;
  }
  // Summoner spells
  if (fighter.flashCooldown > 0) fighter.flashCooldown--;
  if (fighter.igniteCooldown > 0) fighter.igniteCooldown--;
  // Potion tick
  if (fighter.potionActive && fighter.potionTimer > 0) {
    const hpPerTick = 120 / 5; // 120 HP over 5 turns (15s / 3s)
    const heal = Math.min(hpPerTick, fighter.potionHpLeft);
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + heal);
    fighter.potionHpLeft -= heal;
    fighter.potionTimer--;
    if (fighter.potionTimer <= 0) fighter.potionActive = false;
  }
}

// ── Set cooldown in turns (seconds / 3) ──
export function setCooldown(fighter, skill) {
  const data = LEE_SIN.skills[skill];
  const rank = fighter.skillLevels[skill];
  if (rank === 0) return;
  const cdSeconds = Array.isArray(data.cooldown) && data.cooldown.length >= rank
    ? data.cooldown[rank - 1]
    : data.cooldown[0];
  fighter.cooldowns[skill] = Math.ceil(cdSeconds / 3);
}

// ── Energy management ──
export function spendEnergy(fighter, amount) {
  if (fighter.energy < amount) return false;
  fighter.energy -= amount;
  return true;
}

export function restoreEnergy(fighter, amount) {
  fighter.energy = Math.min(fighter.maxEnergy, fighter.energy + amount);
}

// Natural energy regen: 50 per 5s = 30 per turn (3s)
export function tickEnergy(fighter) {
  restoreEnergy(fighter, 30);
}

// ── Shield ──
export function applyShield(fighter) {
  const rank = fighter.skillLevels.W;
  if (rank === 0) return 0;
  const amount = LEE_SIN.skills.W.shield[rank - 1];
  fighter.shield = amount;
  fighter.shieldTimer = 1; // ~2s = ~1 turn
  return amount;
}

// ── XP & leveling ──
export function grantXp(fighter, amount) {
  fighter.xp += amount;
  const table = LEE_SIN.xpToLevel;
  while (fighter.level < 9 && fighter.xp >= table[fighter.level]) {
    applyLevelUp(fighter);
  }
}

// ── Win check ──
export function checkWinner(game) {
  if (game.player.hp <= 0) return 'enemy';
  if (game.enemy.hp <= 0) return 'player';
  if (game.player.cs >= 100) return 'player';
  if (game.enemy.cs >= 100) return 'enemy';
  return null;
}

// ── Full state (for stateless server round-trip) ──
export function fullState(game) {
  const full = (f) => ({
    hp: Math.round(f.hp * 10) / 10,
    maxHp: f.maxHp,
    energy: Math.round(f.energy),
    maxEnergy: f.maxEnergy,
    ad: f.ad,
    bonusAd: f.bonusAd,
    armor: f.armor,
    mr: f.mr,
    cs: f.cs,
    gold: f.gold,
    level: f.level,
    xp: f.xp,
    shield: Math.round(f.shield),
    shieldTimer: f.shieldTimer,
    skillLevels: { ...f.skillLevels },
    cooldowns: { ...f.cooldowns },
    skillPoints: f.skillPoints,
    marks: { ...f.marks },
    potions: f.potions,
    potionActive: f.potionActive,
    potionTimer: f.potionTimer,
    potionHpLeft: f.potionHpLeft,
    recallUsed: f.recallUsed,
    flashCooldown: f.flashCooldown,
    igniteCooldown: f.igniteCooldown,
    x: f.x, y: f.y,
    inBush: f.inBush,
  });
  return {
    turn: game.turn,
    phase: game.phase,
    difficulty: game.difficulty,
    player: full(game.player),
    enemy: full(game.enemy),
    minions: JSON.parse(JSON.stringify(game.minions)),
    minionWave: game.minionWave,
    minionTimer: game.minionTimer,
    winner: game.winner,
  };
}

// ── Build state snapshot for frontend display ──
export function clientState(game) {
  const strip = (f) => ({
    hp: Math.round(f.hp * 10) / 10,
    maxHp: f.maxHp,
    energy: Math.round(f.energy),
    maxEnergy: f.maxEnergy,
    cs: f.cs,
    gold: f.gold,
    level: f.level,
    shield: Math.round(f.shield),
    skillLevels: { ...f.skillLevels },
    cooldowns: { ...f.cooldowns },
    skillPoints: f.skillPoints,
  });
  return {
    turn: game.turn,
    player: strip(game.player),
    enemy: strip(game.enemy),
    phase: game.phase,
    winner: game.winner,
  };
}
