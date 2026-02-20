// Lee Sin — exact LoL stats (patch V14.20)

export const LEE_SIN = {
  name: '리신',
  nameEn: 'Lee Sin',

  base: {
    hp: 645, hpPerLevel: 108,
    energy: 200,
    ad: 69, adPerLevel: 3.7,
    armor: 36, armorPerLevel: 4.9,
    mr: 32, mrPerLevel: 2.05,
    moveSpeed: 345,
    attackRange: 125,  // melee
  },

  // Starting items: Doran's Blade + 1 Health Potion
  startItems: {
    doranBlade: { ad: 10, lifeSteal: 0.035, cost: 450 },
    healthPotion: { hpRestore: 120, duration: 15, count: 1, cost: 50 },
  },

  skills: {
    Q: {
      name: ['음파', '공명타'],
      maxRank: 5,
      energyCost: [50, 25],       // Q1, Q2
      cooldown: [10, 9, 8, 7, 6], // by rank
      range: 1200,                // Q1 range (24 grid cells)
      gridRange: 24,
      // Q1 damage: base + 115% bonus AD (physical)
      q1Base: [55, 80, 105, 130, 155],
      q1BonusAdRatio: 1.15,
      // Q2 damage: same base + 115% bonus AD, scales 0-100% by missing HP
      q2Base: [55, 80, 105, 130, 155],
      q2BonusAdRatio: 1.15,
      q2MaxBase: [110, 160, 210, 260, 310],
      q2MaxBonusAdRatio: 2.30,
      type: 'physical',
    },
    W: {
      name: ['방호', '철갑'],
      maxRank: 5,
      energyCost: [50, 25],
      cooldown: [12],  // 6s if cast on champion
      cooldownOnChamp: [6],
      range: 700,
      gridRange: 14,
      shield: [70, 115, 160, 205, 250],
      shieldApRatio: 0.80,
      shieldDuration: 2, // seconds
      // W2: life steal / spell vamp
      lifeSteal: [0.10, 0.14, 0.18, 0.22, 0.26],
      lifeStealDuration: 4,
      type: 'shield',
    },
    E: {
      name: ['폭풍', '쇠약'],
      maxRank: 5,
      energyCost: [50, 25],
      cooldown: [8],
      range: 450,
      gridRange: 9,
      // E1: magic damage = base + 100% total AD
      e1Base: [35, 60, 85, 110, 135],
      e1TotalAdRatio: 1.0,
      // E2: slow
      slowPercent: [35, 45, 55, 65, 75],
      slowDuration: 4,
      type: 'magic',
    },
    R: {
      name: ['용의 분노'],
      maxRank: 3,
      energyCost: [0],
      cooldown: [110, 85, 60],
      range: 375,
      gridRange: 8,
      // R damage: base + 200% bonus AD (physical)
      base: [175, 400, 625],
      bonusAdRatio: 2.0,
      knockbackDistance: 800, // 16 grid cells
      type: 'physical',
    },
  },

  passive: {
    name: '연타',
    attackSpeedBonus: 0.40,
    duration: 3,
    energyRestore: {
      firstHit:  [20, 20, 30, 30, 40, 40, 40],  // by level brackets 1,1,7,7,13,13+
      secondHit: [10, 10, 15, 15, 20, 20, 20],
    },
  },

  // XP required per level (cumulative, LoL values)
  xpToLevel: [0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120],

  // Minion XP
  minionXp: { melee: 60, ranged: 30 },
  minionGold: { melee: 21, ranged: 14, cannon: 60 },
};
