import Anthropic from '@anthropic-ai/sdk';
import { buildPromptParts } from './prompt.js';

const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
const MAX_RETRIES = 2;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Call LLM with game state, player input, and history.
 * Returns parsed JSON response.
 */
export async function callLLM(gameState, input, history = []) {
  const { staticPrompt, dynamicPrompt } = buildPromptParts(gameState);

  const systemMessages = [
    {
      type: 'text',
      text: staticPrompt,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: dynamicPrompt,
    },
  ];

  const userMessages = buildUserMessages(input, history);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemMessages,
        messages: userMessages,
      });

      // Check for max_tokens truncation
      if (response.stop_reason === 'max_tokens') {
        console.warn('[LLM] Response truncated (max_tokens)');
        return getFallbackResponse(gameState);
      }

      const text = response.content[0]?.text || '';
      const parsed = extractJSON(text);
      if (parsed) return parsed;

      console.warn(`[LLM] JSON parse failed (attempt ${attempt + 1})`);
    } catch (err) {
      // Don't retry auth/billing errors
      if (err.status === 401 || err.status === 402 || err.status === 403) {
        console.error(`[LLM] Auth error: ${err.status}`);
        return getFallbackResponse(gameState);
      }
      console.warn(`[LLM] API error (attempt ${attempt + 1}):`, err.message);
    }
  }

  console.error('[LLM] All retries failed, using fallback');
  return getFallbackResponse(gameState);
}

function buildUserMessages(input, history) {
  const messages = [];

  // Compress older history, keep last 4 messages (2 turns) verbatim
  if (history.length > 4) {
    const older = history.slice(0, -4);
    const summary = older
      .filter(m => m.role === 'assistant')
      .map(m => {
        try {
          const d = JSON.parse(m.content);
          const acts = (d.actions || []).map(a => `${a.who}:${a.skill}`).join('→');
          return acts || 'no actions';
        } catch { return 'turn'; }
      })
      .join(' | ');
    if (summary) {
      messages.push({ role: 'user', content: `[Previous turns summary: ${summary}]` });
      messages.push({ role: 'assistant', content: '(acknowledged)' });
    }
  }

  // Recent history (last 4 or all if <= 4)
  const recent = history.length > 4 ? history.slice(-4) : history;
  for (const msg of recent) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Current input
  messages.push({ role: 'user', content: input });

  return messages;
}

/**
 * 3-stage JSON extraction
 */
function extractJSON(text) {
  // Stage 1: direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // Stage 2: markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // Stage 3: manual brace matching
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.substring(start, i + 1));
          } catch { break; }
        }
      }
    }
  }

  return null;
}

function getFallbackResponse(gameState) {
  return {
    narrative: '양쪽 모두 조심스럽게 거리를 재고 있다.',
    aiChat: '잠깐 집중이 풀렸음. 다시 집중!',
    actions: [],
    elapsed: 'medium',
    distance: gameState.distance,
    blocked: gameState.blocked,
    cs: { player: 0, enemy: 0 },
    minions: gameState.minions,
    enemySkillUp: null,
    suggestions: [
      { requires: null, ifLevelUp: null, text: '안전하게 미니언 뒤에서 CS 챙기기' },
      { requires: null, ifLevelUp: null, text: '상대 움직임 보면서 거리 유지하기' },
      { requires: null, ifLevelUp: null, text: '미니언 관리하면서 웨이브 밀기' },
    ],
  };
}
