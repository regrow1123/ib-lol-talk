// Summoner Spells — exact LoL values, adapted to turn system (1 turn ≈ 3s)

export const SPELLS = {
  flash: {
    name: '점멸',
    cooldownSeconds: 300,
    cooldownTurns: 100, // 300s / 3s
    gridDistance: 10,    // ~500 units
    description: '즉시 짧은 거리 순간이동',
  },
  ignite: {
    name: '점화',
    cooldownSeconds: 180,
    cooldownTurns: 60,
    range: 600,
    gridRange: 12,
    // True damage over 5 seconds (level-based)
    // Level 1: 70, Level 2: 80, ..., Level 9: 150
    trueDamageByLevel: [70, 80, 90, 100, 110, 120, 130, 140, 150],
    duration: 5,        // seconds
    durationTurns: 2,   // ~5s / 3s
    grievousWounds: 0.4, // 40% healing reduction
    description: '대상에게 지속 고정 피해 + 치유 감소',
  },
  exhaust: {
    name: '탈진',
    cooldownSeconds: 210,
    cooldownTurns: 70,
    range: 650,
    gridRange: 13,
    slowPercent: 30,
    damageReduction: 0.35, // 35% damage reduction
    duration: 3,
    durationTurns: 1,
    description: '둔화 30% + 피해량 35% 감소 (3초)',
  },
  barrier: {
    name: '방어막',
    cooldownSeconds: 180,
    cooldownTurns: 60,
    // Shield by level: 115 + (level-1)*18 approx
    shieldByLevel: [115, 133, 151, 169, 187, 205, 223, 241, 259],
    duration: 2,
    durationTurns: 1,
    description: '2초간 피해 흡수 보호막',
  },
  tp: {
    name: '순간이동',
    cooldownSeconds: 360,
    cooldownTurns: 120,
    channelTurns: 2,    // 4s channel
    description: '타워로 순간이동 (귀환 후 빠른 복귀)',
  },
};
