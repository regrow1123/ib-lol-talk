import { loadChampion } from './champions.js';

const CS_LEVEL_TABLE = [
  { cs: 0, level: 1 },
  { cs: 4, level: 2 },
  { cs: 10, level: 3 },
  { cs: 18, level: 4 },
  { cs: 27, level: 5 },
  { cs: 37, level: 6 },
  { cs: 48, level: 7 },
];

export function csToLevel(cs) {
  let level = 1;
  for (const entry of CS_LEVEL_TABLE) {
    if (cs >= entry.cs) level = entry.level;
    else break;
  }
  return level;
}

export function recalcStats(fighter, championId) {
  const champ = loadChampion(championId);
  const s = champ.baseStats;
  const lv = fighter.level;

  const oldMaxHp = fighter.maxHp;
  fighter.maxHp = Math.round(s.hp + s.hpPerLevel * (lv - 1));
  fighter.ad = Math.round((s.ad + s.adPerLevel * (lv - 1)) * 10) / 10;
  fighter.baseAd = fighter.ad;
  fighter.armor = Math.round((s.armor + s.armorPerLevel * (lv - 1)) * 10) / 10;
  fighter.mr = Math.round((s.mr + s.mrPerLevel * (lv - 1)) * 10) / 10;

  // Preserve HP ratio on level-up
  if (oldMaxHp > 0 && oldMaxHp !== fighter.maxHp) {
    const ratio = fighter.hp / oldMaxHp;
    fighter.hp = Math.round(ratio * fighter.maxHp);
  }
}

function createFighter(championId, spells, rune) {
  const champ = loadChampion(championId);
  const s = champ.baseStats;
  return {
    champion: championId,
    hp: s.hp,
    maxHp: s.hp,
    resource: champ.resourceMax,
    maxResource: champ.resourceMax,
    resourceType: champ.resource,
    level: 1,
    cs: 0,
    ad: s.ad,
    baseAd: s.ad,
    armor: s.armor,
    mr: s.mr,
    skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 1,
    cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    shields: [],
    spells,
    spellCooldowns: [0, 0],
    rune,
  };
}

const RUNES = ['conqueror', 'electrocute', 'grasp'];
const SPELLS = ['flash', 'ignite', 'exhaust', 'barrier', 'teleport'];

function pickRandom(arr, count) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function createGameState(championId, spells, rune) {
  const enemyRune = pickRandom(RUNES, 1)[0];
  const enemySpells = pickRandom(SPELLS, 2);

  return {
    phase: 'skillup',
    distance: 800,
    blocked: true,
    player: createFighter(championId, spells, rune),
    enemy: createFighter(championId, enemySpells, enemyRune),
    minions: {
      player: { melee: 3, ranged: 3 },
      enemy: { melee: 3, ranged: 3 },
    },
    winner: null,
  };
}
