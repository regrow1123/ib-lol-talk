// Minion wave & CS system — LoL-accurate values with grid coordinates

const WAVE_INTERVAL = 10; // new wave every 10 turns (~30s)

// LoL minion stats (early game)
const MINION_STATS = {
  melee:  { hp: 480, ad: 12, armor: 0, gold: 21, xp: 60 },
  ranged: { hp: 320, ad: 23, armor: 0, gold: 14, xp: 30 },
};

const MELEE_COUNT = 3;
const RANGED_COUNT = 3;

export function createMinion(type, side, x, y) {
  const s = MINION_STATS[type];
  return {
    type,
    side, // 'player' | 'enemy'
    x, y, // Grid coordinates
    hp: s.hp,
    maxHp: s.hp,
    ad: s.ad,
    armor: s.armor,
    gold: s.gold,
    xp: s.xp,
    target: null, // index of opposing minion being attacked
  };
}

export function createWave(side) {
  const wave = [];
  const clashX = 30; // MINION_CLASH.x
  const clashY = 12; // MINION_CLASH.y
  
  // Spread minions around clash point with some scatter
  for (let i = 0; i < MELEE_COUNT; i++) {
    const xOffset = (side === 'player' ? -1 : 1) * (2 + i * 1.5);
    const yOffset = (Math.random() - 0.5) * 4; // Some Y-axis scatter
    const x = Math.round(clashX + xOffset);
    const y = Math.round(Math.max(8, Math.min(16, clashY + yOffset))); // Keep in lane
    wave.push(createMinion('melee', side, x, y));
  }
  
  for (let i = 0; i < RANGED_COUNT; i++) {
    const xOffset = (side === 'player' ? -1 : 1) * (4 + i * 1.5);
    const yOffset = (Math.random() - 0.5) * 4;
    const x = Math.round(clashX + xOffset);
    const y = Math.round(Math.max(8, Math.min(16, clashY + yOffset)));
    wave.push(createMinion('ranged', side, x, y));
  }
  
  return wave;
}

export function initMinions() {
  return {
    playerWave: createWave('enemy'),   // enemy minions walking toward player (player can CS these)
    enemyWave: createWave('player'),   // player minions walking toward enemy (enemy can CS these)
    waveTimer: WAVE_INTERVAL,
    deadThisTurn: { player: [], enemy: [] }, // track deaths for XP
  };
}

// Check if a champion is "behind minions" for Q skillshot blocking
export function isBehindMinions(champion, minions, isPlayerChampion) {
  // Get the relevant minion wave (the one that can block for this champion)
  const blockingWave = isPlayerChampion ? minions.playerWave : minions.enemyWave;
  
  if (blockingWave.length === 0) return false;
  
  // Find the frontmost minion x-coordinate
  const frontmostX = isPlayerChampion ? 
    Math.max(...blockingWave.filter(m => m.hp > 0).map(m => m.x)) :
    Math.min(...blockingWave.filter(m => m.hp > 0).map(m => m.x));
  
  // Champion is behind minions if they are closer to their own tower than the frontmost minion
  if (isPlayerChampion) {
    return champion.x < frontmostX; // Player champion behind if x is less than frontmost minion
  } else {
    return champion.x > frontmostX; // Enemy champion behind if x is greater than frontmost minion
  }
}

// Get the frontmost minion x-coordinate for line-of-sight calculations
export function getFrontmostMinionX(minions, side) {
  const wave = side === 'player' ? minions.playerWave : minions.enemyWave;
  const aliveMinions = wave.filter(m => m.hp > 0);
  if (aliveMinions.length === 0) return null;
  
  return side === 'player' ? 
    Math.max(...aliveMinions.map(m => m.x)) :
    Math.min(...aliveMinions.map(m => m.x));
}

// Minions fight each other: each minion attacks one opposing minion
export function tickMinions(minions) {
  minions.deadThisTurn = { player: [], enemy: [] };

  // Player's minions (enemyWave) fight enemy minions (playerWave)
  // Each minion from one side attacks the frontmost minion of the other side
  fightWaves(minions.enemyWave, minions.playerWave, minions.deadThisTurn);

  // Remove dead minions
  minions.playerWave = minions.playerWave.filter(m => m.hp > 0);
  minions.enemyWave = minions.enemyWave.filter(m => m.hp > 0);

  // Spawn new waves
  minions.waveTimer--;
  if (minions.waveTimer <= 0) {
    minions.playerWave.push(...createWave('enemy'));
    minions.enemyWave.push(...createWave('player'));
    minions.waveTimer = WAVE_INTERVAL;
  }
}

function fightWaves(attackers, defenders, deadTracker) {
  // Each attacker hits the front-most defender
  // Each defender hits the front-most attacker
  if (attackers.length > 0 && defenders.length > 0) {
    // All attackers focus front defender
    for (const atk of attackers) {
      if (defenders[0] && defenders[0].hp > 0) {
        const dmg = Math.max(1, atk.ad - defenders[0].armor);
        defenders[0].hp -= dmg;
        if (defenders[0].hp <= 0) {
          deadTracker.player.push(defenders[0]); // enemy minion died (player gets XP)
        }
      }
    }
    // All defenders focus front attacker
    for (const def of defenders) {
      if (def.hp <= 0) continue; // already dead
      if (attackers[0] && attackers[0].hp > 0) {
        const dmg = Math.max(1, def.ad - attackers[0].armor);
        attackers[0].hp -= dmg;
        if (attackers[0].hp <= 0) {
          deadTracker.enemy.push(attackers[0]); // player minion died (enemy gets XP)
        }
      }
    }
  }
}

// Check if there's a minion ready to last-hit (HP within one AA)
export function hasLastHittable(wave) {
  return wave.some(m => m.hp > 0 && m.hp <= 80);
}

// Perform last hit on lowest HP minion
export function lastHit(wave, attackerAd) {
  // Find the lowest HP minion that's within last-hit range
  let target = null;
  let lowestHp = Infinity;
  let targetIdx = -1;
  for (let i = 0; i < wave.length; i++) {
    if (wave[i].hp > 0 && wave[i].hp <= (attackerAd || 80) && wave[i].hp < lowestHp) {
      lowestHp = wave[i].hp;
      target = wave[i];
      targetIdx = i;
    }
  }
  if (target) {
    const gold = target.gold;
    const xp = target.xp;
    target.hp = 0;
    wave.splice(targetIdx, 1);
    return { gold, xp, success: true };
  }
  return { gold: 0, xp: 0, success: false };
}

export function getCSableCount(wave, attackerAd) {
  return wave.filter(m => m.hp > 0 && m.hp <= (attackerAd || 80)).length;
}

export { WAVE_INTERVAL };