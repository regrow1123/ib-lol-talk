import Anthropic from '@anthropic-ai/sdk';
import { loadChampion } from '../server/champions.js';
import { buildSuggestionsPrompt } from '../server/prompt.js';

const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
let client = null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameState, skill } = req.body || {};
  if (!gameState || !skill) {
    return res.status(400).json({ error: 'Missing gameState or skill' });
  }

  const state = JSON.parse(JSON.stringify(gameState));
  const player = state.player;

  // Validate
  if (player.skillPoints <= 0) {
    return res.status(400).json({ error: 'No skill points available' });
  }

  const champId = player.champion;
  const champ = loadChampion(champId);
  const skillData = champ.skills[skill];

  if (!skillData) {
    return res.status(400).json({ error: 'Invalid skill key' });
  }

  const maxRank = skillData.maxRank || 5;
  if (player.skillLevels[skill] >= maxRank) {
    return res.status(400).json({ error: 'Skill already at max rank' });
  }

  // R unlock level check
  if (skill === 'R' && skillData.unlockLevel) {
    if (!skillData.unlockLevel.includes(player.level)) {
      return res.status(400).json({ error: `R can only be learned at level ${skillData.unlockLevel.join('/')}` });
    }
  }

  try {
    // Apply
    player.skillLevels[skill]++;
    player.skillPoints--;

    // If no more skill points, switch to play phase + get suggestions
    let suggestions = [];
    if (player.skillPoints <= 0) {
      state.phase = 'play';
      suggestions = await generateSuggestions(state);
    }

    return res.status(200).json({ ok: true, state, suggestions });
  } catch (err) {
    console.error('[skillup] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function generateSuggestions(state) {
  try {
    if (!client) client = new Anthropic();

    const prompt = buildSuggestionsPrompt(state);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = resp.content[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (err) {
    console.error('[skillup suggestions]', err);
    return [];
  }
}
