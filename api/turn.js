// Vercel serverless: POST /api/turn — V2.1 LLM 중심 파이프라인
import { callLLM } from '../server/llm.js';
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
      const types = ['aggressive', 'calculated', 'reactive'];
      gameState.enemy.personality = types[Math.floor(Math.random() * types.length)];
    }

    // === V2.1: LLM이 모든 판정 ===
    const llmResult = await callLLM(gameState, input, history || []);

    // 가드레일 검증
    const validated = validateStateUpdate(llmResult.stateUpdate || {}, gameState);

    // 상태 적용 (diff merge는 applyStateUpdate 내부에서 처리)
    let nextState = applyStateUpdate(gameState, validated);

    // personality 유지
    nextState.enemy.personality = gameState.enemy.personality;

    // gameOver 체크 (LLM 응답 우선, 없으면 서버 판정)
    let gameOver = llmResult.gameOver || null;
    if (!gameOver) {
      if (validated.playerHp <= 0 && validated.enemyHp <= 0) {
        validated.enemyHp = 0;
        validated.playerHp = 1;
        nextState.player.hp = 1;
        nextState.enemy.hp = 0;
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
    }

    if (gameOver) {
      nextState.phase = 'gameover';
      nextState.winner = gameOver.winner;
    }

    // === 레벨업: 서버가 100% 관리 (LLM의 levelUp 무시) ===
    let levelUp = null;

    // 플레이어 레벨업
    const expectedPlayerLevel = csToLevel(validated.playerCs);
    if (expectedPlayerLevel > gameState.player.level) {
      const gained = expectedPlayerLevel - gameState.player.level;
      nextState.player.level = expectedPlayerLevel;
      nextState.player.skillPoints = (nextState.player.skillPoints || 0) + gained;
      nextState.phase = 'skillup';
      const options = ['Q', 'W', 'E'];
      const descs = ['음파/공명타 강화', '방호/철갑 강화', '폭풍/쇠약 강화'];
      if (expectedPlayerLevel >= 6 && gameState.player.skillLevels.R < 1) {
        options.push('R');
        descs.push('용의 분노 해금');
      }
      levelUp = { newLevel: expectedPlayerLevel, who: 'player', options, descriptions: descs };
    }

    // 적 레벨업 자동 처리
    const expectedEnemyLevel = csToLevel(validated.enemyCs);
    if (expectedEnemyLevel > gameState.enemy.level) {
      nextState.enemy.level = expectedEnemyLevel;
      nextState.enemy.skillPoints = 0;
      autoSkillUp(nextState.enemy, expectedEnemyLevel - gameState.enemy.level);
    }

    // suggestions: 항상 LLM이 생성 (레벨업 여부 무관)
    const suggestions = llmResult.suggestions || [];

    console.log(`Turn ${gameState.turn}: "${input}" → HP ${validated.playerHp}/${validated.enemyHp} | CS ${validated.playerCs}/${validated.enemyCs}`);

    res.json({
      state: nextState,
      narrative: llmResult.narrative || '',
      aiChat: llmResult.aiChat || null,
      suggestions,
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
