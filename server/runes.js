// Keystone Runes — simplified for turn-based system

export const RUNES = {
  conqueror: {
    name: '정복자',
    // Each attack/skill grants 2 stacks (max 12)
    maxStacks: 12,
    stacksPerHit: 2,
    // At max stacks: bonus AD + heal
    // Bonus AD per stack: 2-4.5 (level scaling) → simplified to 2 + 0.3 * (level-1)
    bonusAdPerStack: (level) => 2 + 0.3 * (level - 1),
    maxStackHealPercent: 0.08, // heal for 8% of damage dealt at max stacks
    stackDuration: 2, // turns before stacks decay
    description: '교전 중 스택 → AD 증가 + 최대 스택 시 피해량의 8% 회복',
  },
  electrocute: {
    name: '감전',
    // 3 unique hits within ~3s → bonus damage
    hitsRequired: 3,
    // Damage: 30-180 (level) + 40% bonus AD + 25% AP
    baseDamageByLevel: [30, 40, 50, 65, 80, 95, 110, 130, 150],
    bonusAdRatio: 0.40,
    cooldownTurns: 8, // ~25s
    type: 'adaptive', // physical for Lee Sin (AD > AP)
    description: '3회 공격 시 추가 피해 (쿨 25초)',
  },
  grasp: {
    name: '착취의 손아귀',
    // Every ~4s in combat, next AA deals bonus damage + heals
    chargeTurns: 2, // ~4s / ~3s per turn, rounds up
    // Melee: 3.5% of own max HP as bonus magic damage
    bonusDamagePercent: 0.035,
    // Heals for 1.75% of own max HP
    healPercent: 0.0175,
    // Permanently gain 5 HP per proc
    permanentHp: 5,
    type: 'magic',
    description: '4초마다 AA에 최대체력 3.5% 추가 피해 + 1.75% 회복 + 영구 체력 5',
  },
};
