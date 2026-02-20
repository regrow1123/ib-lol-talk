// ib-lol talk — Main UI controller
const $ = id => document.getElementById(id);

// Mock game state (will come from server later)
let state = {
  turn: 1,
  player: { hp: 645, maxHp: 645, energy: 200, maxEnergy: 200, cs: 0, gold: 0, level: 1, x: 10, y: 12, shield: 0, skillLevels: { Q:0,W:0,E:0,R:0 }, cooldowns: { Q:0,W:0,E:0,R:99 }, skillPoints: 1 },
  enemy:  { hp: 645, maxHp: 645, energy: 200, maxEnergy: 200, cs: 0, gold: 0, level: 1, x: 50, y: 12, shield: 0, skillLevels: { Q:1,W:0,E:0,R:0 }, cooldowns: { Q:0,W:0,E:0,R:99 }, skillPoints: 0 },
  phase: 'skillup', // skillup | play | waiting | gameover
};

let sending = false;

// ── Init ──
function init() {
  renderCanvas();
  renderStatus();
  checkPhase();

  // Send button
  $('send-btn').onclick = submit;
  $('player-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  // Example chips
  document.querySelectorAll('.example').forEach(el => {
    el.onclick = () => {
      $('player-input').value = el.dataset.text;
      $('player-input').focus();
    };
  });
}

// ── Submit player input ──
async function submit() {
  if (sending || state.phase !== 'play') return;
  const input = $('player-input').value.trim();
  if (!input) return;

  sending = true;
  $('player-input').value = '';
  setInputEnabled(false);

  // Show player's action in feed
  addNarrative(input, 'player-action');

  // Show loading
  const loadingEl = addNarrative('생각 중', 'system loading-dots');

  try {
    // TODO: replace with actual server call
    // const res = await fetch('/api/turn', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ input, state }) });
    // const data = await res.json();

    // Mock response for now
    await new Promise(r => setTimeout(r, 800));
    const data = mockTurnResponse(input);

    // Remove loading
    loadingEl.remove();

    // Show enemy action
    if (data.enemyAction) {
      addNarrative(`적: ${data.enemyAction}`, 'enemy-reveal');
    }

    // Show result narrative
    if (data.narrative) {
      addNarrative(data.narrative, 'result');
    }

    // Update state
    if (data.state) {
      state = data.state;
    }

    renderCanvas();
    renderStatus();
    checkPhase();

  } catch (err) {
    loadingEl.remove();
    addNarrative('⚠️ 오류가 발생했습니다.', 'system');
  }

  sending = false;
  setInputEnabled(true);
  $('player-input').focus();
}

// ── Narrative feed ──
function addNarrative(text, className) {
  const feed = $('narrative-feed');
  const el = document.createElement('div');
  el.className = `narrative-entry ${className}`;
  el.textContent = text;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  return el;
}

// ── Input state ──
function setInputEnabled(on) {
  $('player-input').disabled = !on;
  $('send-btn').disabled = !on;
}

// ── Phase check ──
function checkPhase() {
  if (state.phase === 'skillup' && state.player.skillPoints > 0) {
    showSkillUp();
    setInputEnabled(false);
    $('input-hint').textContent = '스킬을 먼저 선택하세요';
  } else if (state.phase === 'gameover') {
    setInputEnabled(false);
    showGameOver();
  } else {
    state.phase = 'play';
    setInputEnabled(true);
    $('input-hint').textContent = '어떻게 하시겠습니까?';
    $('skillup-overlay').classList.add('hidden');
  }
}

// ── Skill level up overlay ──
function showSkillUp() {
  const overlay = $('skillup-overlay');
  const container = $('skillup-buttons');
  container.innerHTML = '';
  overlay.classList.remove('hidden');

  const skills = [
    { key: 'Q', name: '음파 / 공명타', dmg: ['55','80','105','130','155'] },
    { key: 'W', name: '방호 / 철갑', dmg: ['70','115','160','205','250'] },
    { key: 'E', name: '폭풍 / 쇠약', dmg: ['35','60','85','110','135'] },
    { key: 'R', name: '용의 분노', dmg: ['175','400','625'] },
  ];

  for (const s of skills) {
    const lv = state.player.skillLevels[s.key];
    const canLevel = lv < (s.key === 'R' ? 3 : 5) && state.player.skillPoints > 0;
    // R only at 6,11,16
    const rBlock = s.key === 'R' && ![6,11,16].includes(state.player.level);

    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    const nextVal = lv < s.dmg.length ? s.dmg[lv] : '-';
    btn.textContent = `${s.key} - ${s.name} [Lv.${lv}] → ${nextVal}`;
    btn.disabled = !canLevel || rBlock;

    if (canLevel && !rBlock) {
      btn.onclick = () => {
        state.player.skillLevels[s.key]++;
        state.player.skillPoints--;
        // Reset R cooldown when first learned
        if (s.key !== 'R' || state.player.skillLevels[s.key] === 1) {
          // set cooldown to 0 for non-R, R keeps its cooldown
        }
        renderStatus();
        if (state.player.skillPoints <= 0) {
          overlay.classList.add('hidden');
          state.phase = 'play';
          checkPhase();
          addNarrative(`${s.key} 스킬을 배웠습니다.`, 'system');
        } else {
          showSkillUp(); // refresh buttons
        }
      };
    }
    container.appendChild(btn);
  }
}

// ── Game over ──
function showGameOver() {
  const overlay = $('gameover-overlay');
  overlay.classList.remove('hidden');
  $('gameover-text').textContent = state.winner === 'player' ? '🏆 승리!' : '💀 패배...';
  $('restart-btn').onclick = () => {
    overlay.classList.add('hidden');
    $('narrative-feed').innerHTML = '';
    // Reset state (will come from server /api/start)
    state = {
      turn: 1,
      player: { hp: 645, maxHp: 645, energy: 200, maxEnergy: 200, cs: 0, gold: 0, level: 1, x: 10, y: 12, shield: 0, skillLevels: { Q:0,W:0,E:0,R:0 }, cooldowns: { Q:0,W:0,E:0,R:99 }, skillPoints: 1 },
      enemy:  { hp: 645, maxHp: 645, energy: 200, maxEnergy: 200, cs: 0, gold: 0, level: 1, x: 50, y: 12, shield: 0, skillLevels: { Q:1,W:0,E:0,R:0 }, cooldowns: { Q:0,W:0,E:0,R:99 }, skillPoints: 0 },
      phase: 'skillup',
    };
    init();
  };
}

// ── Status bars ──
function renderStatus() {
  const p = state.player, e = state.enemy;

  $('p-hp-fill').style.width = `${(p.hp/p.maxHp)*100}%`;
  $('p-hp-text').textContent = `${Math.round(p.hp)} / ${p.maxHp}`;
  $('p-energy-fill').style.width = `${(p.energy/p.maxEnergy)*100}%`;
  $('p-energy-text').textContent = `${Math.round(p.energy)} / ${p.maxEnergy}`;
  $('p-cs').textContent = p.cs;
  $('p-gold').textContent = p.gold;
  $('p-level').textContent = `Lv.${p.level}`;

  $('e-hp-fill').style.width = `${(e.hp/e.maxHp)*100}%`;
  $('e-hp-text').textContent = `${Math.round(e.hp)} / ${e.maxHp}`;
  $('e-energy-fill').style.width = `${(e.energy/e.maxEnergy)*100}%`;
  $('e-energy-text').textContent = `${Math.round(e.energy)} / ${e.maxEnergy}`;
  $('e-cs').textContent = e.cs;
  $('e-gold').textContent = e.gold;
  $('e-level').textContent = `Lv.${e.level}`;

  $('turn-badge').textContent = `${state.turn}턴`;

  // Cooldowns
  for (const side of ['p','e']) {
    const f = side === 'p' ? p : e;
    for (const s of ['Q','W','E','R']) {
      const el = $(`${side}-cd-${s.toLowerCase()}`);
      const lv = f.skillLevels[s];
      const cd = f.cooldowns[s];
      if (lv === 0) { el.textContent = s; el.className = 'cd on-cd'; }
      else if (cd > 0) { el.textContent = `${s}${lv}:${cd}`; el.className = 'cd on-cd'; }
      else { el.textContent = `${s}${lv}`; el.className = 'cd'; }
    }
  }

  // Shield
  for (const [side, f] of [['p',p],['e',e]]) {
    const shEl = $(`${side}-shield-fill`);
    if (f.shield > 0) { shEl.style.width = `${(f.shield/f.maxHp)*100}%`; shEl.classList.remove('hidden'); }
    else { shEl.classList.add('hidden'); }
  }
}

// ── Canvas ──
function renderCanvas() {
  const canvas = $('lane-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Grid → pixel mapping
  const pad = 40;
  const gx = x => pad + (x / 60) * (W - pad * 2);
  const gy = y => 10 + (y / 24) * (H - 20);

  // Background
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, W, H);

  // Bush areas
  ctx.fillStyle = 'rgba(34, 85, 34, 0.15)';
  ctx.fillRect(gx(18), gy(2), gx(42) - gx(18), gy(5) - gy(2));
  ctx.fillRect(gx(18), gy(19), gx(42) - gx(18), gy(22) - gy(19));
  // Bush labels
  ctx.fillStyle = '#2d5a2d';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('부쉬', gx(30), gy(3.8));
  ctx.fillText('부쉬', gx(30), gy(20.8));

  // Lane road
  ctx.fillStyle = '#151d28';
  ctx.fillRect(gx(0), gy(8), gx(60) - gx(0), gy(16) - gy(8));

  // Lane center line
  ctx.strokeStyle = '#1e2a38';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(gx(0), gy(12));
  ctx.lineTo(gx(60), gy(12));
  ctx.stroke();
  ctx.setLineDash([]);

  // Towers
  const drawTower = (x, y, color, label) => {
    const px = gx(x), py = gy(y);
    ctx.fillStyle = color + '33';
    ctx.fillRect(px - 8, py - 16, 16, 32);
    ctx.fillStyle = color;
    ctx.fillRect(px - 5, py - 12, 10, 24);
    ctx.fillStyle = '#5a6a7a';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, py - 20);
  };
  drawTower(3, 12, '#3498db', '아군 타워');
  drawTower(57, 12, '#e74c3c', '적 타워');

  // Minion clash area indicator
  ctx.strokeStyle = '#2a354533';
  ctx.lineWidth = 1;
  ctx.strokeRect(gx(26), gy(9), gx(34) - gx(26), gy(15) - gy(9));

  // Champions
  const drawChamp = (f, color, label) => {
    const px = gx(f.x), py = gy(f.y);
    const s = 16;

    // Square outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(px - s/2, py - s/2, s, s);

    // HP bar
    const bw = s + 4, bh = 3;
    const bx = px - bw/2, by = py - s/2 - 6;
    ctx.fillStyle = '#111';
    ctx.fillRect(bx, by, bw, bh);
    const pct = f.hp / f.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(bx, by, bw * pct, bh);

    // Label
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, py + 3);
  };

  drawChamp(state.player, '#3498db', '나');
  drawChamp(state.enemy, '#e74c3c', '적');

  // Distance
  const dist = Math.abs(state.player.x - state.enemy.x);
  ctx.fillStyle = '#5a6a7a';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  const distLabel = dist <= 3 ? '근접' : dist <= 9 ? 'E사거리' : dist <= 24 ? 'Q사거리' : '원거리';
  ctx.fillText(`거리 ${dist} (${distLabel})`, W - 10, 14);
}

// ── Mock server response (temporary) ──
function mockTurnResponse(input) {
  // Placeholder until server is implemented
  state.turn++;
  return {
    enemyAction: '미니언 뒤에서 CS를 노린다',
    narrative: `당신은 "${input}"을(를) 시도했습니다. 아직 서버가 연결되지 않아 결과를 처리할 수 없습니다.`,
    state: { ...state, phase: 'play' },
  };
}

// ── Start ──
document.addEventListener('DOMContentLoaded', init);
