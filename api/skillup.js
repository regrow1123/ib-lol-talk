// Vercel serverless: POST /api/skillup
// Stateless — client sends skill, server validates and returns updated partial state

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Skill-up is now handled purely client-side (no server state needed)
  // This endpoint just validates the request
  const { skill } = req.body || {};
  const valid = ['Q', 'W', 'E', 'R'];
  if (!valid.includes(skill)) return res.status(400).json({ error: '잘못된 스킬입니다' });

  res.json({ ok: true, skill });
}
