// V2 Guardrail validation — validates LLM stateUpdate
const VALID_POSITIONS = ['MELEE_RANGE', 'MID_RANGE', 'BEHIND_MINIONS', 'BUSH', 'TOWER_RANGE', 'FAR'];

export function validateStateUpdate(stateUpdate, prevState) {
  if (!stateUpdate || typeof stateUpdate !== 'object') {
    throw new Error('stateUpdate가 없거나 유효하지 않습니다');
  }

  const s = { ...stateUpdate };

  // HP: clamp 0~100
  s.playerHp = clamp(s.playerHp ?? prevState.player.hp, 0, 100);
  s.enemyHp = clamp(s.enemyHp ?? prevState.enemy.hp, 0, 100);

  // Energy: clamp 0~200
  s.playerEnergy = clamp(s.playerEnergy ?? prevState.player.energy, 0, 200);
  s.enemyEnergy = clamp(s.enemyEnergy ?? prevState.enemy.energy, 0, 200);

  // Shield: clamp 0+
  s.playerShield = Math.max(0, s.playerShield ?? 0);
  s.enemyShield = Math.max(0, s.enemyShield ?? 0);

  // Cooldowns: clamp 0+
  s.playerCooldowns = clampCooldowns(s.playerCooldowns, prevState.player.cooldowns);
  s.enemyCooldowns = clampCooldowns(s.enemyCooldowns, prevState.enemy.cooldowns);

  // CS: cannot decrease
  s.playerCs = Math.max(s.playerCs ?? prevState.player.cs, prevState.player.cs);
  s.enemyCs = Math.max(s.enemyCs ?? prevState.enemy.cs, prevState.enemy.cs);

  // Level: cannot decrease
  s.playerLevel = Math.max(s.playerLevel ?? prevState.player.level, prevState.player.level);
  s.enemyLevel = Math.max(s.enemyLevel ?? prevState.enemy.level, prevState.enemy.level);

  // Gold: cannot decrease
  s.playerGold = Math.max(s.playerGold ?? prevState.player.gold, prevState.player.gold);
  s.enemyGold = Math.max(s.enemyGold ?? prevState.enemy.gold, prevState.enemy.gold);

  // Position: validate tag
  if (!VALID_POSITIONS.includes(s.playerPosition)) s.playerPosition = prevState.player.position;
  if (!VALID_POSITIONS.includes(s.enemyPosition)) s.enemyPosition = prevState.enemy.position;

  // Tower HP: clamp 0~100
  if (s.towerHp) {
    s.towerHp.player = clamp(s.towerHp.player ?? prevState.tower.player, 0, 100);
    s.towerHp.enemy = clamp(s.towerHp.enemy ?? prevState.tower.enemy, 0, 100);
  } else {
    s.towerHp = { ...prevState.tower };
  }

  // Minions: ensure structure
  if (!s.minions || typeof s.minions !== 'object') {
    s.minions = JSON.parse(JSON.stringify(prevState.minions));
  } else {
    s.minions.player = s.minions.player || prevState.minions.player;
    s.minions.enemy = s.minions.enemy || prevState.minions.enemy;
  }

  // Spell cooldowns: clamp 0+
  s.playerSpellCooldowns = clampSpellCooldowns(s.playerSpellCooldowns, prevState.player.spellCooldowns);
  s.enemySpellCooldowns = clampSpellCooldowns(s.enemySpellCooldowns, prevState.enemy.spellCooldowns);

  // Buffs/debuffs: ensure arrays
  s.playerBuffs = Array.isArray(s.playerBuffs) ? s.playerBuffs : [];
  s.enemyBuffs = Array.isArray(s.enemyBuffs) ? s.enemyBuffs : [];
  s.playerDebuffs = Array.isArray(s.playerDebuffs) ? s.playerDebuffs : [];
  s.enemyDebuffs = Array.isArray(s.enemyDebuffs) ? s.enemyDebuffs : [];

  return s;
}

function clamp(val, min, max) {
  if (typeof val !== 'number' || isNaN(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function clampSpellCooldowns(cds, prev) {
  if (!Array.isArray(cds)) return prev ? [...prev] : [0, 0];
  return cds.map((v, i) => Math.max(0, Math.round(typeof v === 'number' ? v : (prev?.[i] ?? 0))));
}

function clampCooldowns(cds, prev) {
  const result = { Q: 0, W: 0, E: 0, R: 0 };
  const src = cds && typeof cds === 'object' ? cds : prev;
  for (const key of ['Q', 'W', 'E', 'R']) {
    result[key] = Math.max(0, Math.round(src[key] ?? 0));
  }
  return result;
}
