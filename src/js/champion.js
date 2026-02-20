// Lee Sin data — exact LoL stats from LEE_SIN_DATA.md
export const LEE_SIN = {
  name: '리신',
  baseStats: {
    hp: 645, hpPerLevel: 108,
    energy: 200,
    energyRegen5: 50,
    ad: 69, adPerLevel: 3.7,
    armor: 36, armorPerLevel: 4.9,
    mr: 32, mrPerLevel: 2.05,
    attackSpeed: 0.651,
    moveSpeed: 345,
    attackRange: 125,
  },
  // Doran's Blade
  startingItems: {
    doransBlade: { ad: 10, lifesteal: 0.035, cost: 450 },
    healthPotion: { heal: 120, duration: 5, cost: 50 }, // 5 turns ~15s
  },
  passive: {
    name: '연타',
    attackSpeedBonus: 0.4,
    duration: 2, // 2 attacks
    energyRestore: [20, 30, 40], // level 1/7/13
    energyRestore2: [10, 15, 20],
  },
  skills: {
    Q: {
      name1: '음파', name2: '공명타',
      energyCost1: 50, energyCost2: 25,
      cooldown: [10, 9, 8, 7, 6], // by skill level
      cooldownTurns: 4, // ~10s / 3s
      range: 'medium', // 1-2 lane distance
      type: 'skillshot',
      baseDamage1: [55, 80, 105, 130, 155],
      bonusAdRatio1: 1.15,
      baseDamage2: [55, 80, 105, 130, 155],
      bonusAdRatio2: 1.15,
      // Q2: +0-100% based on missing HP
    },
    W: {
      name1: '방호', name2: '철갑',
      energyCost1: 50, energyCost2: 25,
      cooldown: [12, 12, 12, 12, 12],
      cooldownTurns: 4,
      range: 'self',
      type: 'shield',
      shieldBase: [70, 115, 160, 205, 250],
      shieldApRatio: 0.8,
      lifesteal: [0.10, 0.14, 0.18, 0.22, 0.26],
      lifestealDuration: 2, // turns
      shieldDuration: 1, // turn (2s)
    },
    E: {
      name1: '폭풍', name2: '쇠약',
      energyCost1: 50, energyCost2: 25,
      cooldown: [8, 8, 8, 8, 8],
      cooldownTurns: 3,
      range: 'melee', // adjacent
      type: 'aoe',
      baseDamage1: [35, 60, 85, 110, 135],
      totalAdRatio1: 1.0,
      slowPercent: [0.35, 0.45, 0.55, 0.65, 0.75],
      slowDuration: 2, // turns
    },
    R: {
      name1: '용의 분노',
      energyCost1: 0,
      cooldown: [110, 85, 60],
      cooldownTurns: 37,
      range: 'melee',
      type: 'targeted',
      baseDamage1: [175, 400, 625],
      bonusAdRatio1: 2.0,
      knockbackDistance: 800,
    }
  }
};

export function getStatsAtLevel(level, items = { doransBlade: true }) {
  const b = LEE_SIN.baseStats;
  const lvl = level - 1;
  const bonusAd = items.doransBlade ? LEE_SIN.startingItems.doransBlade.ad : 0;
  return {
    maxHp: Math.floor(b.hp + b.hpPerLevel * lvl),
    energy: b.energy,
    totalAd: Math.floor((b.ad + b.adPerLevel * lvl) + bonusAd),
    baseAd: Math.floor(b.ad + b.adPerLevel * lvl),
    bonusAd: bonusAd,
    armor: Math.round((b.armor + b.armorPerLevel * lvl) * 10) / 10,
    mr: Math.round((b.mr + b.mrPerLevel * lvl) * 10) / 10,
    attackSpeed: b.attackSpeed,
    moveSpeed: b.moveSpeed,
  };
}

export function getSkillLevel(champLevel) {
  // Prototype: everyone has skill level 1 for all skills
  // R available at level 6
  return { Q: 1, W: 1, E: 1, R: champLevel >= 6 ? 1 : 0 };
}
