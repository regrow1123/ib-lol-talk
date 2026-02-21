// Vercel serverless: POST /api/turn — V3 의도 기반 전투 파이프라인
import { parseIntent } from '../server/intent.js';
import { resolveIntent } from '../server/combat.js';
import { decideAiAction, assignPersonality } from '../server/ai.js';
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
    // 게임 시작 시 enemy personality 없으면 배정
    if (!gameState.enemy.personality) {
      gameState.enemy.personality = assignPersonality();
    }

    // === V3 의도 기반 파이프라인 ===

    // 1. parseIntent → playerIntent (main + sub + skills)
    const playerIntent = await parseIntent(input, gameState);
    console.log(`Turn ${gameState.turn}: "${input}" → intent:`, JSON.stringify(playerIntent));

    // 2. decideAiAction → enemyIntent (main + sub + skills)
    const playerHistory = history || [];
    const enemyIntent = decideAiAction(gameState, playerHistory);
    console.log(`Turn ${gameState.turn}: AI(${gameState.enemy.personality}) → intent:`, JSON.stringify(enemyIntent));

    // 3. resolveIntent → events + stateChanges
    const { events, stateChanges } = resolveIntent(playerIntent, enemyIntent, gameState);

    // 4. 가드레일 검증
    const validated = validateStateUpdate(stateChanges, gameState);

    // 5. 서술 생성 (LLM 경량)
    const narrateState = {
      ...gameState,
      player: { ...gameState.player, hp: validated.playerHp },
      enemy: { ...gameState.enemy, hp: validated.enemyHp },
    };
    const { narrative, aiChat } = await narrate(events, narrateState);

    // 6. Suggestions (규칙 기반)
    const nextStatePreview = {
      ...gameState,
      player: { ...gameState.player, hp: validated.playerHp, energy: validated.playerEnergy, cooldowns: validated.playerCooldowns },
      enemy: { ...gameState.enemy, hp: validated.enemyHp, energy: validated.enemyEnergy, cooldowns: validated.enemyCooldowns },
    };
    const suggestions = generateSuggestions(nextStatePreview);

    // 7. 상태 적용
    let nextState = applyStateUpdate(gameState, validated);

    // personality 유지
    nextState.enemy.personality = gameState.enemy.personality;

    // 8. gameOver 체크
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

    // 9. levelUp 체크
    let levelUp = null;
    const expectedPlayerLevel = csToLevel(validated.playerCs);
    const expectedEnemyLevel = csToLevel(validated.enemyCs);

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
      autoSkillUp(nextState.enemy, expectedEnemyLevel - gameState.enemy.level);
    }

    console.log(`Turn ${gameState.turn}: HP ${validated.playerHp}/${validated.enemyHp} | CS ${validated.playerCs}/${validated.enemyCs} | ${events[0]?.resultCode || 'N/A'}`);

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
    if (enemy.level >= 6 && enemy.skillLevels.R < 1) { enemy.skillLevels.R++; continue; }
    if (enemy.level >= 11 && enemy.skillLevels.R < 2) { enemy.skillLevels.R++; continue; }
    if (enemy.level >= 16 && enemy.skillLevels.R < 3) { enemy.skillLevels.R++; continue; }
    for (const sk of priority) {
      if (enemy.skillLevels[sk] < 5) { enemy.skillLevels[sk]++; break; }
    }
  }
}
