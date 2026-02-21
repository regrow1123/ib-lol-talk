// Vercel serverless: POST /api/suggest — lightweight suggestions-only LLM call
import Anthropic from '@anthropic-ai/sdk';
import { loadChampion } from '../server/champions.js';

const client = new Anthropic();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, context } = req.body || {};
  if (!gameState) return res.status(400).json({ error: 'gameState 필요' });

  const champ = loadChampion(gameState.player.champion);
  const p = gameState.player, e = gameState.enemy;

  const skillStatus = (f) => Object.entries(champ.skills).map(([k, s]) => {
    const lv = f.skillLevels[k], cd = f.cooldowns[k];
    const st = lv === 0 ? '✗' : cd > 0 ? `쿨${cd}` : '✓';
    return `${k}Lv${lv}[${st}]`;
  }).join(' ');

  const prompt = `LoL 1v1 리신 미러. 현재 상황 기반 suggestions 1~3개만 JSON 배열로.
P: HP${p.hp}% 기${p.energy} Lv${p.level} ${skillStatus(p)} 위치:${p.position}
E: HP${e.hp}% 기${e.energy} Lv${e.level} ${skillStatus(e)} 위치:${e.position}
${context ? '상황: ' + context : ''}
규칙: [✓]스킬만. 심리전/읽기느낌(상대행동예측). HP높→공격, HP낮→방어, 쿨중→CS. 교육적근거포함. 중복금지.
JSON 배열만 출력: ["선택지1","선택지2","선택지3"]`;

  try {
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const suggestions = JSON.parse(match[0]);
      return res.json({ suggestions });
    }
    res.json({ suggestions: [] });
  } catch (err) {
    console.error('Suggest error:', err.message);
    res.json({ suggestions: [] });
  }
}
