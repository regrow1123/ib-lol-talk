// Vercel serverless: POST /api/turn — V3 하이브리드 파이프라인
import { parseIntent } from '../server/intent.js';
import { resolveAction, mergeChanges } from '../server/combat.js';
import { decideAiAction } from '../server/ai.js';
import { generateSuggestions } from '../server/suggest.js';
import { narrate } from '../server/narrator.js';
import { validateStateUpdate } from '../server/validate.js';
import { applyStateUpdate } from '../server/game.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, input, history } = req.body || {};
  if (!gameState || !input) {
    return res.status(400).json({ error: 'gameState와 input이 필요합니다' });
  }

  if (gameState.phase === 'gameover') {
    return res.json({ state: gameState, narrative: '게임이 이미 종료되었습니다.', aiChat: null, suggestions: [] });
  }

  try {
    // === V3 파이프라인 ===

    // 1. Intent 해석 (LLM 경량)
    const intent = await parseIntent(input, gameState);
    console.log(`Turn ${gameState.turn}: "${input}" → intent:`, JSON.stringify(intent));

    // 2. 플레이어 액션 규칙 엔진
    const playerResult = resolveAction(intent, gameState, 'player');

    // 3. AI 행동 결정 (규칙 엔진)
    const aiIntent = decideAiAction(gameState, playerResult);

    // 4. AI 액션 규칙 엔진 — 플레이어 결과를 반영한 중간 상태로
    const midState = applyMidState(gameState, playerResult.stateChanges);
    const aiResult = resolveAction(aiIntent, midState, 'enemy');

    // 5. 상태 병합
    const merged = mergePlayerAndAi(gameState, playerResult.stateChanges, aiResult.stateChanges);

    // 6. 가드레일 검증
    const validated = validateStateUpdate(merged, gameState);

    // 7. 서술 생성 (LLM 경량)
    const allEvents = [...playerResult.events, ...aiResult.events];
    const { narrative, aiChat } = await narrate(allEvents, {
      ...gameState,
      player: { ...gameState.player, hp: validated.playerHp },
      enemy: { ...gameState.enemy, hp: validated.enemyHp },
    });

    // 8. Suggestions (규칙 기반)
    const nextStatePreview = { ...gameState, player: { ...gameState.player, hp: validated.playerHp, energy: validated.playerEnergy, cooldowns: validated.playerCooldowns }, enemy: { ...gameState.enemy, hp: validated.enemyHp, energy: validated.enemyEnergy, cooldowns: validated.enemyCooldowns } };
    const suggestions = generateSuggestions(nextStatePreview);

    // 9. 상태 적용
    let nextState = applyStateUpdate(gameState, validated);

    // 10. gameOver 체크
    let gameOver = null;
    if (validated.playerHp <= 0 && validated.enemyHp <= 0) {
      validated.enemyHp = 0;
      validated.playerHp = 1;
      gameOver = { winner: 'player', reason: 'kill', summary: '아슬아슬하게 적을 먼저 처치했습니다!' };
    } else if (validated.playerHp <= 0) {
      gameOver = { winner: 'enemy', reason: 'kill', summary: '적에게 처치당했습니다.' };
    } else if (validated.enemyHp <= 0) {
      gameOver = { winner: 'player', reason: 'kill', summary: '적을 처치했습니다!' };
    } else if (validated.playerCs >= 50) {
      gameOver = { winner: 'player', reason: 'cs', summary: 'CS 50 달성!' };
    } else if (validated.enemyCs >= 50) {
      gameOver = { winner: 'enemy', reason: 'cs', summary: '적이 먼저 CS 50에 도달했습니다.' };
    } else if (validated.towerHp?.enemy <= 0) {
      gameOver = { winner: 'player', reason: 'tower', summary: '적 타워를 파괴했습니다!' };
    } else if (validated.towerHp?.player <= 0) {
      gameOver = { winner: 'enemy', reason: 'tower', summary: '아군 타워가 파괴되었습니다.' };
    }

    if (gameOver) {
      nextState.phase = 'gameover';
      nextState.winner = gameOver.winner;
    }

    // 11. levelUp 체크
    let levelUp = null;
    const newPlayerCs = validated.playerCs;
    const newEnemyCs = validated.enemyCs;
    const expectedPlayerLevel = csToLevel(newPlayerCs);
    const expectedEnemyLevel = csToLevel(newEnemyCs);

    if (expectedPlayerLevel > gameState.player.level) {
      nextState.player.level = expectedPlayerLevel;
      nextState.player.skillPoints = (nextState.player.skillPoints || 0) + (expectedPlayerLevel - gameState.player.level);
      nextState.phase = 'skillup';
      const options = ['Q', 'W', 'E'];
      const descs = ['음파/공명타 강화', '방호/철갑 강화', '폭풍/쇠약 강화'];
      if (expectedPlayerLevel >= 6 && gameState.player.skillLevels.R < 1) {
        options.push('R');
        descs.push('용의 분노 해금');
      }
      levelUp = { newLevel: expectedPlayerLevel, who: 'player', options, descriptions: descs };
    }

    if (expectedEnemyLevel > gameState.enemy.level) {
      nextState.enemy.level = expectedEnemyLevel;
      nextState.enemy.skillPoints = 0;
      // AI auto skill-up
      autoSkillUp(nextState.enemy, expectedEnemyLevel - gameState.enemy.level);
    }

    console.log(`Turn ${gameState.turn}: HP ${validated.playerHp}/${validated.enemyHp} | CS ${validated.playerCs}/${validated.enemyCs}`);

    res.json({
      state: nextState,
      narrative,
      aiChat,
      suggestions: levelUp ? [] : suggestions,
      levelUp,
      gameOver,
    });
  } catch (err) {
    console.error('Turn error:', err.message, err.stack);
    res.status(500).json({ error: '턴 처리 중 오류: ' + err.message });
  }
}

// 플레이어 결과를 중간 상태로 적용 (AI가 이 상태 기준으로 행동)
function applyMidState(gameState, playerChanges) {
  return {
    ...gameState,
    player: {
      ...gameState.player,
      hp: playerChanges.attackerHp,
      energy: playerChanges.attackerEnergy,
      cooldowns: { ...playerChanges.attackerCooldowns },
      position: playerChanges.attackerPosition,
      shield: playerChanges.attackerShield,
      cs: playerChanges.attackerCs,
      gold: playerChanges.attackerGold,
    },
    enemy: {
      ...gameState.enemy,
      hp: playerChanges.defenderHp,
      energy: playerChanges.defenderEnergy,
      cooldowns: { ...playerChanges.defenderCooldowns },
      position: playerChanges.defenderPosition,
      shield: playerChanges.defenderShield,
      cs: playerChanges.defenderCs,
      gold: playerChanges.defenderGold,
      buffs: playerChanges.defenderBuffs || [],
      debuffs: playerChanges.defenderDebuffs || [],
    },
  };
}

// 두 결과 병합 (플레이어→적 공격 + AI→플레이어 공격)
function mergePlayerAndAi(gameState, pChanges, aiChanges) {
  return {
    playerHp: aiChanges.defenderHp,
    enemyHp: aiChanges.attackerHp,
    playerEnergy: aiChanges.defenderEnergy,
    enemyEnergy: aiChanges.attackerEnergy,
    playerCooldowns: aiChanges.defenderCooldowns,
    enemyCooldowns: aiChanges.attackerCooldowns,
    playerPosition: aiChanges.defenderPosition,
    enemyPosition: aiChanges.attackerPosition,
    playerCs: aiChanges.defenderCs,
    enemyCs: aiChanges.attackerCs,
    playerLevel: gameState.player.level,
    enemyLevel: gameState.enemy.level,
    playerGold: aiChanges.defenderGold,
    enemyGold: aiChanges.attackerGold,
    playerShield: aiChanges.defenderShield,
    enemyShield: aiChanges.attackerShield,
    playerBuffs: aiChanges.defenderBuffs || [],
    enemyBuffs: aiChanges.attackerBuffs || [],
    playerDebuffs: aiChanges.defenderDebuffs || [],
    enemyDebuffs: aiChanges.attackerDebuffs || [],
    playerSpellCooldowns: aiChanges.defenderSpellCooldowns || [0, 0],
    enemySpellCooldowns: aiChanges.attackerSpellCooldowns || [0, 0],
    towerHp: { ...gameState.tower },
    minions: JSON.parse(JSON.stringify(gameState.minions)),
  };
}

function csToLevel(cs) {
  if (cs >= 40) return 9;
  if (cs >= 35) return 8;
  if (cs >= 30) return 7;
  if (cs >= 25) return 6;
  if (cs >= 20) return 5;
  if (cs >= 16) return 4;
  if (cs >= 13) return 3;
  if (cs >= 7) return 2;
  return 1;
}

function autoSkillUp(enemy, points) {
  const priority = ['Q', 'E', 'W'];
  for (let i = 0; i < points; i++) {
    // R at 6, 11, 16
    if (enemy.level >= 6 && enemy.skillLevels.R < 1) {
      enemy.skillLevels.R++;
      continue;
    }
    if (enemy.level >= 11 && enemy.skillLevels.R < 2) {
      enemy.skillLevels.R++;
      continue;
    }
    if (enemy.level >= 16 && enemy.skillLevels.R < 3) {
      enemy.skillLevels.R++;
      continue;
    }
    for (const sk of priority) {
      if (enemy.skillLevels[sk] < 5) {
        enemy.skillLevels[sk]++;
        break;
      }
    }
  }
}
