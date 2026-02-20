// ib-lol talk — Game Server
import express from 'express';
import cors from 'cors';
import { createGame, clientState } from './game.js';
import { interpretTurn } from './llm.js';
import { resolveTurn } from './resolve.js';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory game sessions
const games = new Map();

// ── POST /api/start ──
// Create a new game, return initial state
app.post('/api/start', (req, res) => {
  const { difficulty = 'normal' } = req.body || {};
  const game = createGame(difficulty);
  games.set(game.id, game);

  console.log(`[${game.id.slice(0,8)}] New game started (${difficulty})`);

  res.json({
    gameId: game.id,
    state: clientState(game),
    narrative: '⚔️ 미드 라인에 첫 미니언 웨이브가 도착했다. 리신 vs 리신 — 라인전 시작!',
  });
});

// ── POST /api/turn ──
// Process a player turn
app.post('/api/turn', async (req, res) => {
  const { gameId, input } = req.body;

  if (!gameId || !input) {
    return res.status(400).json({ error: 'gameId와 input이 필요합니다' });
  }

  const game = games.get(gameId);
  if (!game) {
    return res.status(404).json({ error: '게임을 찾을 수 없습니다' });
  }

  if (game.phase === 'gameover') {
    return res.json({
      state: clientState(game),
      narrative: '게임이 이미 종료되었습니다.',
      enemyAction: null,
    });
  }

  try {
    // 1. LLM interprets player input + decides AI action + resolves
    const llmResult = await interpretTurn(game, input);

    // 2. Server validates and applies exact damage/state changes
    const { dmgLog, state } = resolveTurn(game, llmResult);

    console.log(`[${gameId.slice(0,8)}] Turn ${game.turn}: P="${input}" → ${llmResult.playerAction.type} | AI=${llmResult.aiAction.type} | dmg P:${Math.round(dmgLog.playerDealt)} E:${Math.round(dmgLog.enemyDealt)}`);

    res.json({
      state,
      narrative: llmResult.narrative,
      enemyAction: llmResult.aiChat,
      playerAction: llmResult.playerAction.detail,
      aiAction: llmResult.aiAction.detail,
    });
  } catch (err) {
    console.error(`[${gameId.slice(0,8)}] Error:`, err.message);
    res.status(500).json({ error: '턴 처리 중 오류가 발생했습니다' });
  }
});

// ── POST /api/skillup ──
// Level up a skill
app.post('/api/skillup', (req, res) => {
  const { gameId, skill } = req.body;

  const game = games.get(gameId);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다' });

  const p = game.player;
  if (p.skillPoints <= 0) return res.status(400).json({ error: '스킬 포인트가 없습니다' });

  const valid = ['Q', 'W', 'E', 'R'];
  if (!valid.includes(skill)) return res.status(400).json({ error: '잘못된 스킬입니다' });

  const maxRank = skill === 'R' ? 3 : 5;
  if (p.skillLevels[skill] >= maxRank) return res.status(400).json({ error: '이미 최대 레벨입니다' });
  if (skill === 'R' && ![6, 11, 16].includes(p.level)) return res.status(400).json({ error: 'R은 6/11/16 레벨에만 배울 수 있습니다' });

  p.skillLevels[skill]++;
  p.skillPoints--;
  if (p.level >= 6 && p.cooldowns.R === 99) p.cooldowns.R = 0;

  if (p.skillPoints <= 0) game.phase = 'play';

  res.json({
    state: clientState(game),
    skill,
    newRank: p.skillLevels[skill],
  });
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', games: games.size });
});

// ── Start ──
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ib-lol talk server running on :${PORT}`);
});
