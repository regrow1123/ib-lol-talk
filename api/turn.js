// Vercel serverless: POST /api/turn
// Stateless — client sends full game state + input, server calls LLM + resolves
import { interpretTurn } from '../server/llm.js';
import { resolveTurn } from '../server/resolve.js';
import { fullState } from '../server/game.js';

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
    return res.json({
      state: gameState,
      narrative: '게임이 이미 종료되었습니다.',
      enemyAction: null,
    });
  }

  try {
    // LLM interprets player input + decides AI action
    const llmResult = await interpretTurn(gameState, input, history || []);

    // Server validates and applies exact damage/state changes
    const { dmgLog, state } = resolveTurn(gameState, llmResult);

    console.log(`Turn ${gameState.turn}: "${input}" → ${llmResult.playerAction.type} | AI=${llmResult.aiAction.type}`);

    // Build narrative from actual server events (not LLM's guess)
    const skillNames = { Q1:'음파', Q2:'공명타', E1:'폭풍', R:'용의 분노', AA:'기본공격', IGNITE:'점화' };
    const eventLines = [];
    for (const ev of dmgLog.events) {
      const who = ev.who === 'player' ? '내' : '적';
      const skill = skillNames[ev.skill] || ev.skill;
      if (ev.result === 'hit') {
        eventLines.push(`${who} ${skill} 적중! (${ev.dmg} 피해)`);
      } else if (ev.result === 'miss') {
        eventLines.push(`${who} ${skill} 빗나감${ev.reason ? ' — ' + ev.reason : ''}`);
      } else if (ev.result === 'invalid') {
        eventLines.push(`${who} ${skill} 사용 불가`);
      }
    }
    // Add CS info
    const pCs = llmResult.resolution?.playerCs || 0;
    const aCs = llmResult.resolution?.aiCs || 0;
    if (pCs > 0) eventLines.push(`CS +${pCs}`);

    let narrative = eventLines.length > 0 ? eventLines.join(' / ') : (llmResult.narrative || '소강 상태');

    res.json({
      state,
      narrative,
      enemyAction: llmResult.aiChat,
      playerAction: llmResult.playerAction.detail,
      aiAction: llmResult.aiAction.detail,
      suggestions: llmResult.suggestions || [],
    });
  } catch (err) {
    console.error('Turn error:', err.message);
    res.status(500).json({ error: '턴 처리 중 오류: ' + err.message });
  }
}
