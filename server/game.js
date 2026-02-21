// V2 Game state — simplified. LLM handles all judgment.
import { randomUUID } from 'crypto';

export function createGame(spells = ['flash', 'ignite'], rune = 'conqueror') {
  return {
    id: randomUUID(),
    turn: 1,
    phase: 'skillup',
    player: createFighter(spells, rune),
    enemy: createFighter(['flash', 'ignite'], 'conqueror', { skillPoints: 0, skillLevels: { Q: 1, W: 0, E: 0, R: 0 } }),
    minions: {
      player: { melee: 3, ranged: 3 },
      enemy: { melee: 3, ranged: 3 },
    },
    tower: { player: 100, enemy: 100 },
    winner: null,
  };
}

function createFighter(spells, rune, overrides = {}) {
  return {
    champion: 'lee-sin',
    hp: 100,
    maxHp: 100,
    energy: 200,
    maxEnergy: 200,
    level: 1,
    cs: 0,
    gold: 0,
    skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 1,
    cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    position: '중거리',
    shield: 0,
    spells,
    spellCooldowns: [0, 0],
    rune,
    buffs: [],
    debuffs: [],
    ...overrides,
  };
}

export function fullState(game) {
  return {
    turn: game.turn,
    phase: game.phase,
    player: { ...game.player },
    enemy: { ...game.enemy },
    minions: JSON.parse(JSON.stringify(game.minions)),
    tower: { ...game.tower },
    winner: game.winner,
  };
}

// Apply validated stateUpdate to game state (diff merge — validated already has defaults from validate.js)
export function applyStateUpdate(gameState, validated) {
  const next = JSON.parse(JSON.stringify(gameState));
  next.turn += 1;

  // Player fields
  next.player.hp = validated.playerHp;
  next.player.energy = validated.playerEnergy;
  next.player.cooldowns = { ...validated.playerCooldowns };
  next.player.position = validated.playerPosition;
  next.player.cs = validated.playerCs;
  next.player.level = validated.playerLevel;
  next.player.gold = validated.playerGold;
  next.player.shield = validated.playerShield;
  next.player.buffs = validated.playerBuffs;
  next.player.debuffs = validated.playerDebuffs;
  if (validated.playerSpellCooldowns) next.player.spellCooldowns = [...validated.playerSpellCooldowns];

  // Enemy fields
  next.enemy.hp = validated.enemyHp;
  next.enemy.energy = validated.enemyEnergy;
  next.enemy.cooldowns = { ...validated.enemyCooldowns };
  next.enemy.position = validated.enemyPosition;
  next.enemy.cs = validated.enemyCs;
  next.enemy.level = validated.enemyLevel;
  next.enemy.gold = validated.enemyGold;
  next.enemy.shield = validated.enemyShield;
  next.enemy.buffs = validated.enemyBuffs;
  next.enemy.debuffs = validated.enemyDebuffs;
  if (validated.enemySpellCooldowns) next.enemy.spellCooldowns = [...validated.enemySpellCooldowns];

  next.tower = { ...validated.towerHp };
  next.minions = JSON.parse(JSON.stringify(validated.minions));

  return next;
}
