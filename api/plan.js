import Anthropic from '@anthropic-ai/sdk';
import { buildPlanPrompt } from '../server/prompt.js';

const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
const MAX_RETRIES = 2;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameState, history } = req.body || {};
  if (!gameState) {
    return res.status(400).json({ error: 'Missing gameState' });
  }

  try {
    const { staticPrompt, dynamicPrompt } = buildPlanPrompt(gameState);

    const systemMessages = [
      { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPrompt },
    ];

    // Build minimal history context for plan
    const userMessages = buildPlanMessages(history || []);

    let result = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await getClient().messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemMessages,
          messages: userMessages,
        });

        if (response.stop_reason === 'max_tokens') {
          console.warn('[plan] Response truncated');
          break;
        }

        const text = response.content[0]?.text || '';
        const parsed = extractJSON(text);
        if (parsed && parsed.playerActions && parsed.enemyAction) {
          result = parsed;
          break;
        }
        console.warn(`[plan] JSON parse failed (attempt ${attempt + 1})`);
      } catch (err) {
        if (err.status === 401 || err.status === 402 || err.status === 403) {
          console.error(`[plan] Auth error: ${err.status}`);
          break;
        }
        console.warn(`[plan] API error (attempt ${attempt + 1}):`, err.message);
      }
    }

    if (!result) {
      result = getFallbackPlan();
    }

    return res.status(200).json({
      playerActions: result.playerActions,
      enemyAction: result.enemyAction,
      enemySkillUp: result.enemySkillUp || null,
    });
  } catch (err) {
    console.error('[plan]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildPlanMessages(history) {
  const messages = [];

  // Summarize recent history for context
  if (history.length > 0) {
    const recent = history.slice(-4);
    const summary = recent
      .filter(m => m.role === 'assistant')
      .map(m => {
        try {
          const d = JSON.parse(m.content);
          return d.narrative || 'turn';
        } catch { return 'turn'; }
      })
      .join(' → ');
    if (summary) {
      messages.push({ role: 'user', content: `[최근 전투: ${summary}]` });
      messages.push({ role: 'assistant', content: '(확인)' });
    }
  }

  messages.push({ role: 'user', content: '다음 턴 행동을 계획해줘.' });
  return messages;
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.substring(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

function getFallbackPlan() {
  return {
    playerActions: [
      { action: 'CS farm', skills: [], target: null, requires: null, text: '안전하게 미니언 뒤에서 CS 챙기기' },
      { action: 'poke', skills: [], target: 'enemy', requires: null, text: '상대 움직임 보면서 거리 유지하기' },
      { action: 'wave manage', skills: [], target: null, requires: null, text: '미니언 관리하면서 웨이브 밀기' },
    ],
    enemyAction: { action: 'CS farm', skills: [], target: null, text: 'CS 좀 먹어야지' },
    enemySkillUp: null,
  };
}
