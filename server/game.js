// Game state creation and management
import { loadChampion } from './champions.js';

export function createGameState(championId, spells, rune) {
  const champ = loadChampion(championId);
  const stats = champ.baseStats;

  const fighter = (spells, rune) => ({
    champion: championId,
    hp: stats.hp,
    maxHp: stats.hp,
    resource: champ.resourceMax,
    maxResource: champ.resourceMax,
    resourceType: champ.resource,
    level: 1,
    cs: 0,
    gold: 0,
    ad: stats.ad + (champ.startItems.default.ad || 0),
    baseAd: stats.ad,
    armor: stats.armor,
    mr: stats.mr,
    skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 1,
    cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    shield: 0,
    spells,
    spellCooldowns: [0, 0],
    rune,
    buffs: [],
    debuffs: [],
  });

  // Random enemy rune
  const runes = ['conqueror', 'electrocute', 'grasp'];
  const enemyRune = runes[Math.floor(Math.random() * runes.length)];
  // Random enemy spells (2 of 5, different from each other)
  const allSpells = ['flash', 'ignite', 'exhaust', 'barrier', 'tp'];
  const shuffled = allSpells.sort(() => Math.random() - 0.5);
  const enemySpells = shuffled.slice(0, 2);

  return {
    turn: 1,
    phase: 'skillup',
    distance: 800,
    blocked: true,
    player: fighter(spells, rune),
    enemy: fighter(enemySpells, enemyRune),
    minions: {
      player: { melee: 3, ranged: 3 },
      enemy: { melee: 3, ranged: 3 },
    },
    winner: null,
  };
}

// Level up stats recalculation
export function recalcStats(fighter, championId) {
  const champ = loadChampion(championId);
  const s = champ.baseStats;
  const lv = fighter.level;
  fighter.maxHp = Math.round(s.hp + s.hpPerLevel * (lv - 1));
  fighter.ad = Math.round((s.ad + s.adPerLevel * (lv - 1)) + (champ.startItems.default.ad || 0));
  fighter.baseAd = Math.round(s.ad + s.adPerLevel * (lv - 1));
  fighter.armor = Math.round(s.armor + s.armorPerLevel * (lv - 1));
  fighter.mr = Math.round(s.mr + s.mrPerLevel * (lv - 1));
}

// CS → Level table
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
  }
  return level;
}
