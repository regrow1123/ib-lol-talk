// ib-lol talk — KakaoTalk-style chat UI
const $ = id => document.getElementById(id);

let state = {
  turn: 1,
  player: { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:15,y:12,shield:0,
            skillLevels:{Q:0,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:1 },
  enemy:  { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:45,y:12,shield:0,
            skillLevels:{Q:1,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:0 },
  phase: 'skillup',
};
let sending = false;
let drawerOpen = false;

// ── Init ──
function init() {
  renderCanvas();
  renderStatus();
  checkPhase();

  addSystemMsg('⚔️ 리신 vs 리신 — 라인전 시작');

  $('send-btn').onclick = submit;
  $('player-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  $('info-toggle').onclick = () => {
    drawerOpen = !drawerOpen;
    $('info-drawer').classList.toggle('hidden', !drawerOpen);
    if (drawerOpen) renderCanvas();
  };

  document.querySelectorAll('.chip').forEach(el => {
    el.onclick = () => {
      $('player-input').value = el.dataset.text;
      $('player-input').focus();
    };
  });
}

// ── Submit ──
async function submit() {
  if (sending || state.phase !== 'play') return;
  const input = $('player-input').value.trim();
  if (!input) return;

  sending = true;
  $('player-input').value = '';
  setInput(false);

  // My message
  addMyMsg(input);

  // Typing indicator
  const typing = addTypingIndicator();

  try {
    // TODO: actual server call
    await new Promise(r => setTimeout(r, 800));
    const data = mockTurn(input);
    typing.remove();

    if (data.enemyAction) addEnemyMsg(data.enemyAction);
    if (data.narrative) addNarratorMsg(data.narrative);
    if (data.state) state = data.state;

    renderStatus();
    if (drawerOpen) renderCanvas();
    checkPhase();
  } catch {
    typing.remove();
    addSystemMsg('⚠️ 오류가 발생했습니다');
  }

  sending = false;
  setInput(true);
  $('player-input').focus();
}

// ── Message helpers ──
function addMyMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg me';
  div.innerHTML = `
    <div class="msg-time">${timeStr()}</div>
    <div class="msg-body"><div class="bubble">${esc(text)}</div></div>`;
  feed.appendChild(div);
  scrollBottom();
}

function addEnemyMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg them';
  div.innerHTML = `
    <div class="msg-avatar enemy-avatar">적</div>
    <div class="msg-body">
      <div class="msg-name">적 리신</div>
      <div class="bubble">${esc(text)}</div>
    </div>
    <div class="msg-time">${timeStr()}</div>`;
  feed.appendChild(div);
  scrollBottom();
}

function addNarratorMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg them narrator';
  div.innerHTML = `
    <div class="msg-avatar narrator-avatar">⚔️</div>
    <div class="msg-body">
      <div class="msg-name">심판</div>
      <div class="bubble">${esc(text)}</div>
    </div>`;
  feed.appendChild(div);
  scrollBottom();
}

function addSystemMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg center';
  div.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  feed.appendChild(div);
  scrollBottom();
}

function addTypingIndicator() {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg them';
  div.innerHTML = `
    <div class="msg-avatar narrator-avatar">⚔️</div>
    <div class="msg-body">
      <div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
    </div>`;
  feed.appendChild(div);
  scrollBottom();
  return div;
}

function scrollBottom() {
  const feed = $('chat-feed');
  requestAnimationFrame(() => feed.scrollTop = feed.scrollHeight);
}

function timeStr() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${m}`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Input state ──
function setInput(on) {
  $('player-input').disabled = !on;
  $('send-btn').disabled = !on;
}

// ── Phase ──
function checkPhase() {
  if (state.phase === 'skillup' && state.player.skillPoints > 0) {
    showSkillUp();
    setInput(false);
  } else if (state.phase === 'gameover') {
    setInput(false);
    showGameOver();
  } else {
    state.phase = 'play';
    setInput(true);
    $('skillup-overlay').classList.add('hidden');
  }
}

// ── Skill Up ──
function showSkillUp() {
  const overlay = $('skillup-overlay');
  const box = $('skillup-buttons');
  box.innerHTML = '';
  overlay.classList.remove('hidden');

  const skills = [
    { key:'Q', name:'음파/공명타', vals:['55','80','105','130','155'] },
    { key:'W', name:'방호/철갑', vals:['70','115','160','205','250'] },
    { key:'E', name:'폭풍/쇠약', vals:['35','60','85','110','135'] },
    { key:'R', name:'용의 분노', vals:['175','400','625'] },
  ];

  for (const s of skills) {
    const lv = state.player.skillLevels[s.key];
    const maxLv = s.key === 'R' ? 3 : 5;
    const canLevel = lv < maxLv && state.player.skillPoints > 0;
    const rBlock = s.key === 'R' && ![6,11,16].includes(state.player.level);

    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    const next = lv < s.vals.length ? s.vals[lv] : '-';
    btn.textContent = `${s.key} — ${s.name}  [Lv.${lv}]  → ${next}`;
    btn.disabled = !canLevel || rBlock;

    if (canLevel && !rBlock) {
      btn.onclick = () => {
        state.player.skillLevels[s.key]++;
        state.player.skillPoints--;
        renderStatus();
        if (state.player.skillPoints <= 0) {
          overlay.classList.add('hidden');
          state.phase = 'play';
          checkPhase();
          addSystemMsg(`${s.key} 스킬을 배웠습니다`);
        } else {
          showSkillUp();
        }
      };
    }
    box.appendChild(btn);
  }
}

// ── Game Over ──
function showGameOver() {
  $('gameover-overlay').classList.remove('hidden');
  $('gameover-text').textContent = state.winner === 'player' ? '🏆 승리!' : '💀 패배...';
  $('restart-btn').onclick = () => {
    $('gameover-overlay').classList.add('hidden');
    $('chat-feed').innerHTML = '';
    state = {
      turn:1,
      player:{hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:15,y:12,shield:0,
              skillLevels:{Q:0,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:1},
      enemy:{hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:45,y:12,shield:0,
             skillLevels:{Q:1,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:0},
      phase:'skillup',
    };
    init();
  };
}

// ── Status ──
function renderStatus() {
  const p = state.player, e = state.enemy;
  $('p-hp-fill').style.width = `${(p.hp/p.maxHp)*100}%`;
  $('p-hp-text').textContent = `${Math.round(p.hp)}/${p.maxHp}`;
  $('p-energy-fill').style.width = `${(p.energy/p.maxEnergy)*100}%`;
  $('p-energy-text').textContent = `${Math.round(p.energy)}/${p.maxEnergy}`;
  $('p-cs').textContent = p.cs;
  $('p-gold').textContent = p.gold;
  $('p-level').textContent = `Lv.${p.level}`;

  $('e-hp-fill').style.width = `${(e.hp/e.maxHp)*100}%`;
  $('e-hp-text').textContent = `${Math.round(e.hp)}/${e.maxHp}`;
  $('e-energy-fill').style.width = `${(e.energy/e.maxEnergy)*100}%`;
  $('e-energy-text').textContent = `${Math.round(e.energy)}/${e.maxEnergy}`;
  $('e-cs').textContent = e.cs;
  $('e-gold').textContent = e.gold;
  $('e-level').textContent = `Lv.${e.level}`;

  $('turn-text').textContent = `${state.turn}턴`;

  for (const [pre,f] of [['p',p],['e',e]]) {
    for (const s of ['Q','W','E','R']) {
      const el = $(`${pre}-cd-${s.toLowerCase()}`);
      const lv = f.skillLevels[s], cd = f.cooldowns[s];
      if (lv === 0) { el.textContent = s; el.className = 'cd on-cd'; }
      else if (cd > 0) { el.textContent = `${s}${lv}:${cd}`; el.className = 'cd on-cd'; }
      else { el.textContent = `${s}${lv}`; el.className = 'cd'; }
    }
  }
}

// ── Canvas ──
// Full SR minimap. Mid lane = diagonal (bottom-left → top-right).
// Grid x: 0-60 along mid lane. y: 0-24 perpendicular to lane.

let mapBg = null;
let champIcon = null;
// tower icon loaded via canvas drawing

const mapImg = new Image();
mapImg.src = 'img/minimap.png';
mapImg.onload = () => { mapBg = mapImg; renderCanvas(); };

const champImg = new Image();
champImg.src = 'img/leesin.png';
champImg.onload = () => { champIcon = champImg; renderCanvas(); };

// Tower drawn directly on canvas (LoL minimap style)

// Player = RED team (top-right), Enemy = BLUE team (bottom-left)
// Mid lane 1st tower positions on 1000x1000 reference
const RED_T1  = { x: 605, y: 400 }; // player tower (red mid T1)
const BLUE_T1 = { x: 400, y: 605 }; // enemy tower (blue mid T1)

// Lane endpoints: slightly beyond T1 towers
// grid x=0 = player tower area (red), x=60 = enemy tower area (blue)
const MID_START = { x: 650, y: 355 }; // grid x=0 (behind red T1)
const MID_END   = { x: 355, y: 650 }; // grid x=60 (behind blue T1)

// Perpendicular direction to mid lane (normalized)
// Mid lane direction: (1, -1)/sqrt(2). Perpendicular: (1, 1)/sqrt(2)
const PERP_X = 1 / Math.SQRT2;
const PERP_Y = 1 / Math.SQRT2;

function gridToMap(gx, gy, mapSize) {
  const t = gx / 60;
  const mx = MID_START.x + t * (MID_END.x - MID_START.x);
  const my = MID_START.y + t * (MID_END.y - MID_START.y);
  // Perpendicular offset (gy=12 is center of lane)
  const perpOffset = (gy - 12) * 3;
  const px = (mx + perpOffset * PERP_X) * (mapSize / 1000);
  const py = (my + perpOffset * PERP_Y) * (mapSize / 1000);
  return { x: px, y: py };
}

function renderCanvas() {
  const canvas = $('lane-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  if (mapBg) {
    ctx.drawImage(mapBg, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
  }

  // Map coords are on 1000x1000 reference, canvas is WxH
  const s = W / 1000;

  // ── Towers ──
  const drawTower = (mapX, mapY, col) => {
    const px = mapX * s, py = mapY * s;
    const r = W * 0.03; // 3% of canvas width

    // Filled circle with glow
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = r * 2;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // White border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();

    // Cross/plus inside (turret look)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py - r * 0.6);
    ctx.lineTo(px, py + r * 0.6);
    ctx.moveTo(px - r * 0.6, py);
    ctx.lineTo(px + r * 0.6, py);
    ctx.stroke();
  };
  drawTower(RED_T1.x, RED_T1.y, '#ff4444');
  drawTower(BLUE_T1.x, BLUE_T1.y, '#4488ff');

  // ── Minions (tiny dots like real minimap) ──
  const rng = seededRng(state.turn);
  const drawMinion = (gx, gy, col) => {
    const p = gridToMap(gx, gy, W);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  };
  // Red minions (player side — closer to grid x=0, player tower)
  for (let i = 0; i < 6; i++) {
    drawMinion(28 - rng() * 5, 10.5 + rng() * 3, '#ee4444');
  }
  // Blue minions (enemy side — closer to grid x=60, enemy tower)
  for (let i = 0; i < 6; i++) {
    drawMinion(32 + rng() * 5, 10.5 + rng() * 3, '#4488ee');
  }

  // ── Champions (circular portrait like real LoL minimap) ──
  const drawChamp = (f, borderCol) => {
    const p = gridToMap(f.x, f.y, W);
    const r = 10;

    ctx.save();

    // Clip circle for portrait
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Draw champion portrait
    if (champIcon) {
      ctx.drawImage(champIcon, p.x - r, p.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#333';
      ctx.fill();
    }

    ctx.restore();

    // Border ring (team color)
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();

  };
  drawChamp(state.player, '#ff3333');  // player = red team
  drawChamp(state.enemy, '#00aaff');   // enemy = blue team

  // (distance info moved to status area)
}

function seededRng(seed) {
  let s = seed * 16807 + 31;
  return () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; };
}

// ── Mock ──
function mockTurn(input) {
  state.turn++;
  return {
    enemyAction: '미니언 뒤에서 CS를 노린다',
    narrative: `"${input}" — 서버 연결 후 결과가 표시됩니다.`,
    state: { ...state, phase: 'play' },
  };
}

document.addEventListener('DOMContentLoaded', init);
