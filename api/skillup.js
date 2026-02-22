import { loadChampion } from '../server/champions.js';

export default function handler(req, res) {
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

  // Apply
  player.skillLevels[skill]++;
  player.skillPoints--;

  // If no more skill points, switch to play phase
  if (player.skillPoints <= 0) {
    state.phase = 'play';
  }

  return res.status(200).json({ ok: true, state });
}
