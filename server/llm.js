import Anthropic from '@anthropic-ai/sdk';
import { buildResolvePrompt } from './prompt.js';

const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
const MAX_RETRIES = 2;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const RESOLVE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    aiChat: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          who: { type: 'string', enum: ['player', 'enemy'] },
          skill: { type: 'string' },
          target: { type: 'string' },
          hit: { type: 'boolean' },
        },
        required: ['who', 'skill', 'target', 'hit'],
        additionalProperties: false,
      },
    },
    elapsed: { type: 'string', enum: ['instant', 'short', 'medium', 'long', 'very_long'] },
    distance: { type: 'number' },
    blocked: { type: 'boolean' },
    cs: {
      type: 'object',
      properties: {
        player: { type: 'number' },
        enemy: { type: 'number' },
      },
      required: ['player', 'enemy'],
      additionalProperties: false,
    },
    minions: {
      type: 'object',
      properties: {
        player: {
          type: 'object',
          properties: { melee: { type: 'number' }, ranged: { type: 'number' } },
          required: ['melee', 'ranged'],
          additionalProperties: false,
        },
        enemy: {
          type: 'object',
          properties: { melee: { type: 'number' }, ranged: { type: 'number' } },
          required: ['melee', 'ranged'],
          additionalProperties: false,
        },
      },
      required: ['player', 'enemy'],
      additionalProperties: false,
    },
    enemySkillUp: { type: ['string', 'null'] },
  },
  required: ['narrative', 'aiChat', 'actions', 'elapsed', 'distance', 'blocked', 'cs', 'minions', 'enemySkillUp'],
  additionalProperties: false,
};

/**
 * Call LLM for resolve phase.
 */
export async function callResolve(gameState, playerAction, enemyAction, isFreeText, history = []) {
  const { staticPrompt, dynamicPrompt, actionContext } = buildResolvePrompt(gameState, playerAction, enemyAction, isFreeText);

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

  const userMessages = buildUserMessages(history, actionContext);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemMessages,
        messages: userMessages,
        output_config: {
          format: {
            type: 'json_schema',
            schema: RESOLVE_SCHEMA,
          },
        },
      });

      if (response.stop_reason === 'max_tokens') {
        console.warn('[LLM] Response truncated (max_tokens)');
        return getFallbackResponse(gameState);
      }

      const text = response.content[0]?.text || '';
      return JSON.parse(text);
    } catch (err) {
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

function buildUserMessages(history, actionContext) {
  const messages = [];

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

  const recent = history.length > 4 ? history.slice(-4) : history;
  for (const msg of recent) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: actionContext });

  return messages;
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
  };
}
