// Vercel serverless: POST /api/suggest — 스킬업 후 suggestions 요청
import { callLLMSuggestionsOnly } from '../server/llm.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { gameState, history } = req.body || {};
  if (!gameState) return res.status(400).json({ error: 'gameState 필요' });

  try {
    const suggestions = await callLLMSuggestionsOnly(gameState, history || []);
    res.json({ suggestions });
  } catch (err) {
    console.error('Suggest error:', err.message);
    res.json({ suggestions: ['CS 챙기기', '안전하게 대기', '상대 움직임 관찰'] });
  }
}
