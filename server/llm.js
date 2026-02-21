// V2 LLM integration — Anthropic Claude API
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';

const client = new Anthropic();

export async function callLLM(gameState, playerInput, history = []) {
  const systemPrompt = buildSystemPrompt(gameState);

  const messages = [];
  const recentHistory = history.slice(-10);
  for (const h of recentHistory) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: playerInput });

  const response = await client.messages.create({
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const text = response.content[0].text.trim();

  // Extract JSON
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('LLM JSON parse error:', e.message);
    console.error('Raw:', text.substring(0, 500));
    // Fallback
    return {
      narrative: '잠시 소강 상태... 양쪽 모두 조심스럽게 움직인다.',
      aiChat: '음... 뭔가 이상했음. 다시 해보자!',
      stateUpdate: {
        playerHp: gameState.player.hp,
        enemyHp: gameState.enemy.hp,
        playerEnergy: Math.min(200, gameState.player.energy + 30),
        enemyEnergy: Math.min(200, gameState.enemy.energy + 30),
        playerCooldowns: decrementCooldowns(gameState.player.cooldowns),
        enemyCooldowns: decrementCooldowns(gameState.enemy.cooldowns),
        playerPosition: gameState.player.position,
        enemyPosition: gameState.enemy.position,
        playerCs: gameState.player.cs,
        enemyCs: gameState.enemy.cs,
        playerLevel: gameState.player.level,
        enemyLevel: gameState.enemy.level,
        playerGold: gameState.player.gold,
        enemyGold: gameState.enemy.gold,
        playerShield: 0,
        enemyShield: 0,
        playerBuffs: [],
        enemyBuffs: [],
        playerDebuffs: [],
        enemyDebuffs: [],
        towerHp: { ...gameState.tower },
        minions: JSON.parse(JSON.stringify(gameState.minions)),
      },
      levelUp: null,
      suggestions: ['CS 챙기기', 'Q로 견제', '안전하게 대기'],
      gameOver: null,
    };
  }
}

function decrementCooldowns(cds) {
  const result = {};
  for (const [k, v] of Object.entries(cds)) {
    result[k] = Math.max(0, v - 1);
  }
  return result;
}
