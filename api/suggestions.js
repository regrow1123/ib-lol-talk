import Anthropic from '@anthropic-ai/sdk';
import { buildPromptParts } from '../server/prompt.js';

const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Lightweight LLM call to generate suggestions only.
 * Called after mid-game skillup completion.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameState, learnedSkill, history } = req.body || {};
  if (!gameState) {
    return res.status(400).json({ error: 'Missing gameState' });
  }

  try {
    const { staticPrompt, dynamicPrompt } = buildPromptParts(gameState);

    const systemMessages = [
      { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPrompt },
    ];

    // Build context from recent history
    const messages = [];
    const recent = (history || []).slice(-4);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const skillName = learnedSkill || 'new skill';
    messages.push({
      role: 'user',
      content: `Player just leveled up and learned ${skillName}. Generate 5-7 suggestions for their next action.
Consider: the newly learned skill, current HP/resource/cooldown state, distance, minions.
Respond with ONLY a JSON array of suggestions:
[{"requires":"Q"|"W"|"E"|"R"|null, "ifLevelUp":null, "text":"Korean suggestion with reasoning"}]`,
    });

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemMessages,
      messages,
    });

    const text = response.content[0]?.text || '';
    let suggestions = extractSuggestions(text);

    if (!suggestions || suggestions.length === 0) {
      suggestions = getDefaultSuggestions(learnedSkill);
    }

    return res.status(200).json({ suggestions });
  } catch (err) {
    console.error('[suggestions]', err);
    return res.status(200).json({
      suggestions: getDefaultSuggestions(learnedSkill),
    });
  }
}

function extractSuggestions(text) {
  // Try direct parse as array
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.suggestions) return parsed.suggestions;
  } catch {}

  // Try extracting array from text
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }

  // Try extracting from code block
  const codeMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeMatch) {
    try {
      const parsed = JSON.parse(codeMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

function getDefaultSuggestions(skill) {
  const suggestions = [
    { requires: null, ifLevelUp: null, text: '안전하게 CS 챙기면서 상황 보기' },
    { requires: null, ifLevelUp: null, text: '미니언 뒤에서 거리 유지하기' },
  ];
  if (skill) {
    suggestions.unshift({
      requires: skill,
      ifLevelUp: null,
      text: `새로 배운 ${skill} 스킬로 견제 시도`,
    });
  }
  return suggestions;
}
