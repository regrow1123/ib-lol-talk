// V2 LLM integration — Anthropic Claude API
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';

const client = new Anthropic();
const MAX_RETRIES = 2;

export async function callLLM(gameState, playerInput, history = []) {
  const systemPrompt = buildSystemPrompt(gameState);

  const messages = [];
  const recentHistory = history.slice(-10);
  for (const h of recentHistory) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: playerInput });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const text = response.content[0].text.trim();
      const parsed = extractJSON(text);
      if (parsed) return parsed;

      console.error(`LLM JSON parse fail (attempt ${attempt + 1}):`, text.substring(0, 300));
      if (attempt < MAX_RETRIES) continue;
    } catch (err) {
      console.error(`LLM API error (attempt ${attempt + 1}):`, err.message);
      // Don't retry auth/billing errors
      if (err.status === 401 || err.status === 402 || err.status === 403) break;
      if (attempt < MAX_RETRIES) continue;
    }
  }

  // All retries failed — fallback
  console.error('All LLM retries exhausted, using fallback');
  return {
    narrative: '양쪽 모두 조심스럽게 거리를 재고 있다.',
    aiChat: '잠깐 정신이 팔렸음. 다시 집중!',
    stateUpdate: {
      playerHp: gameState.player.hp,
      enemyHp: gameState.enemy.hp,
      playerEnergy: Math.min(200, gameState.player.energy + 30),
      enemyEnergy: Math.min(200, gameState.enemy.energy + 30),
      playerCooldowns: decrementCooldowns(gameState.player.cooldowns),
      enemyCooldowns: decrementCooldowns(gameState.enemy.cooldowns),
      playerSpellCooldowns: gameState.player.spellCooldowns || [0, 0],
      enemySpellCooldowns: gameState.enemy.spellCooldowns || [0, 0],
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
    suggestions: ['CS 챙기기', '안전하게 대기', '상대 움직임 관찰'],
    gameOver: null,
  };
}

function extractJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}

  // Try extracting from code block
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }

  // Try finding outermost { ... } with brace matching
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.substring(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function decrementCooldowns(cds) {
  const result = {};
  for (const [k, v] of Object.entries(cds)) {
    result[k] = Math.max(0, v - 1);
  }
  return result;
}
