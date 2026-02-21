// LLM integration — Anthropic Claude API
import Anthropic from '@anthropic-ai/sdk';
import { buildPromptParts } from './prompt.js';

const client = new Anthropic();
const MAX_RETRIES = 2;

export async function callLLM(gameState, playerInput, history = []) {
  const { staticPrompt, dynamicPrompt } = buildPromptParts(gameState);

  const messages = buildMessages(history, playerInput);

  const system = [
    { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicPrompt },
  ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system,
        messages,
      });

      // Check if truncated
      if (response.stop_reason === 'max_tokens') {
        console.error('LLM response truncated (max_tokens)');
        return fallbackResponse(gameState);
      }

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

  return fallbackResponse(gameState);
}

function buildMessages(history, playerInput) {
  const messages = [];

  // History: recent 2 turns (4 messages) verbatim, older summarized
  const recent = history.slice(-4);
  const older = history.slice(0, -4);

  if (older.length > 0) {
    const summary = summarizeHistory(older);
    messages.push({ role: 'user', content: `[이전 턴 요약] ${summary}` });
    messages.push({ role: 'assistant', content: '{"narrative":"(요약 확인)"}' });
  }

  for (const h of recent) {
    messages.push({ role: h.role, content: h.content });
  }

  messages.push({ role: 'user', content: playerInput });
  return messages;
}

function summarizeHistory(messages) {
  const turns = [];
  for (let i = 0; i < messages.length; i += 2) {
    const userMsg = messages[i]?.content || '';
    const action = userMsg.length > 30 ? userMsg.substring(0, 30) + '…' : userMsg;
    turns.push(action);
  }
  return turns.join(' → ') || '(이전 턴 없음)';
}

function fallbackResponse(gameState) {
  return {
    narrative: '양쪽 모두 조심스럽게 거리를 재고 있다.',
    aiChat: '잠깐 집중이 풀렸음. 다시 집중!',
    actions: [],
    distance: gameState.distance,
    blocked: gameState.blocked,
    cs: { player: 0, enemy: 0 },
    enemySkillUp: null,
    suggestions: [
      { skill: null, text: 'CS 챙기기' },
      { skill: null, text: '안전하게 대기' },
      { skill: null, text: '상대 움직임 관찰' },
    ],
    gameOver: null,
  };
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }

  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, escape = false;
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
