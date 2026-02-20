// Minion wave & CS system

const WAVE_INTERVAL = 10; // new wave every 10 turns (~30s)
const MELEE_COUNT = 3;
const RANGED_COUNT = 3;
const MELEE_HP = 480;
const RANGED_HP = 320;
const MELEE_GOLD = 21;
const RANGED_GOLD = 14;

export function createMinion(type) {
  return {
    type, // 'melee' | 'ranged'
    hp: type === 'melee' ? MELEE_HP : RANGED_HP,
    maxHp: type === 'melee' ? MELEE_HP : RANGED_HP,
    gold: type === 'melee' ? MELEE_GOLD : RANGED_GOLD,
  };
}

export function createWave() {
  const wave = [];
  for (let i = 0; i < MELEE_COUNT; i++) wave.push(createMinion('melee'));
  for (let i = 0; i < RANGED_COUNT; i++) wave.push(createMinion('ranged'));
  return wave;
}

export function initMinions() {
  return {
    playerWave: createWave(), // enemy minions in player's lane (player can CS these)
    enemyWave: createWave(),  // player minions in enemy's lane (enemy can CS these)
    waveTimer: WAVE_INTERVAL,
  };
}

// Simulate minion auto-fighting (reduce HP over time)
export function tickMinions(minions) {
  // Each wave loses HP over time from opposing minions
  const dmgPerTick = 40; // simplified
  for (const wave of [minions.playerWave, minions.enemyWave]) {
    if (wave.length > 0) {
      wave[0].hp -= dmgPerTick;
      if (wave[0].hp <= 0) wave.shift();
    }
  }

  minions.waveTimer--;
  if (minions.waveTimer <= 0) {
    minions.playerWave.push(...createWave());
    minions.enemyWave.push(...createWave());
    minions.waveTimer = WAVE_INTERVAL;
  }
}

// Check if there's a minion ready to last-hit
export function hasLastHittable(wave) {
  return wave.length > 0 && wave[0].hp <= 80; // low enough to last-hit
}

// Perform last hit, return gold earned
export function lastHit(wave) {
  if (wave.length === 0) return { gold: 0, success: false };
  const minion = wave[0];
  if (minion.hp <= 80) {
    const gold = minion.gold;
    wave.shift();
    return { gold, success: true };
  }
  return { gold: 0, success: false };
}

export function getCSableCount(wave) {
  return wave.filter(m => m.hp <= 80).length;
}

export { WAVE_INTERVAL };
