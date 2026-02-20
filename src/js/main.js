// ib-lol talk — KakaoTalk-style chat UI
const $ = id => document.getElementById(id);

let state = {
  turn: 1,
  player: { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:10,y:12,shield:0,
            skillLevels:{Q:0,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:1 },
  enemy:  { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:50,y:12,shield:0,
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
      player:{hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:10,y:12,shield:0,
              skillLevels:{Q:0,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:1},
      enemy:{hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,x:50,y:12,shield:0,
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
// Minimap: full SR map, mid lane runs diagonal (bottom-left to top-right)
// Grid x=0 (player tower) maps to ~bottom-left, x=60 (enemy tower) to ~top-right
// y offset = perpendicular to the diagonal (for bush/lane width)

let mapBg = null;
const mapImg = new Image();
mapImg.src = 'img/minimap.png';
mapImg.onload = () => { mapBg = mapImg; renderCanvas(); };

// Convert game grid (x: 0-60 along mid lane, y: 0-24 perpendicular) to minimap pixel coords
// Mid lane: from ~(190, 810) [blue tower] to ~(810, 190) [red tower] on 1000x1000
const MID_START = { x: 190, y: 810 }; // player tower (grid x=0)
const MID_END   = { x: 810, y: 190 }; // enemy tower (grid x=60)

function gridToMap(gx, gy, mapSize) {
  const t = gx / 60; // 0..1 along mid lane
  // Main axis (along mid lane)
  const mx = MID_START.x + t * (MID_END.x - MID_START.x);
  const my = MID_START.y + t * (MID_END.y - MID_START.y);
  // Perpendicular offset (y: 12 = center, 0 = "left" of lane, 24 = "right")
  // Perpendicular direction to the diagonal: (1,1)/sqrt(2) normalized
  const perpScale = 2.5; // pixels per grid unit perpendicular
  const offset = (gy - 12) * perpScale;
  const px = (mx + offset) * (mapSize / 1000);
  const py = (my + offset) * (mapSize / 1000);
  return { x: px, y: py };
}

function renderCanvas() {
  const canvas = $('lane-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Draw minimap background
  if (mapBg) {
    ctx.drawImage(mapBg, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
  }

  // LoL-style minimap icons

  // Tower dots
  const drawTower = (gx, gy, col) => {
    const p = gridToMap(gx, gy, W);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    // Tower: small filled triangle/diamond like LoL minimap
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 5);
    ctx.lineTo(p.x + 4, p.y + 3);
    ctx.lineTo(p.x - 4, p.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  };
  drawTower(3, 12, '#00ccff');   // player tower (blue)
  drawTower(57, 12, '#ff4444');  // enemy tower (red)

  // Minion dots (small circles, like LoL minimap)
  const drawMinion = (gx, gy, col) => {
    const p = gridToMap(gx, gy, W);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };

  // Simulated minion positions (will come from server state later)
  // Player minions (blue) cluster near clash point
  const rng = seededRng(state.turn);
  for (let i = 0; i < 6; i++) {
    const mx = 28 - rng() * 4;
    const my = 11 + rng() * 2;
    drawMinion(mx, my, '#5599ff');
  }
  // Enemy minions (red)
  for (let i = 0; i < 6; i++) {
    const mx = 32 + rng() * 4;
    const my = 11 + rng() * 2;
    drawMinion(mx, my, '#ff5555');
  }

  // Champion circles (like LoL minimap champion icons)
  const drawChamp = (f, col, borderCol) => {
    const p = gridToMap(f.x, f.y, W);
    const r = 6;

    // Border circle
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();

    // Filled circle
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r - 1, 0, Math.PI * 2); ctx.fill();

    // HP ring (like LoL minimap green ring around champion)
    const pct = f.hp / f.maxHp;
    const hpCol = pct > 0.5 ? '#00ff44' : pct > 0.25 ? '#ffaa00' : '#ff3333';
    ctx.strokeStyle = hpCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
  };
  drawChamp(state.player, '#1166cc', '#33aaff');
  drawChamp(state.enemy, '#cc2222', '#ff4444');

  // Distance overlay (bottom-right corner)
  const dist = Math.abs(state.player.x - state.enemy.x);
  const dl = dist <= 3 ? '근접' : dist <= 9 ? 'E' : dist <= 24 ? 'Q' : '원거리';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const tw = 70, th = 14;
  ctx.fillRect(W - tw - 4, H - th - 4, tw, th);
  ctx.fillStyle = '#ccc';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${dist} (${dl})`, W - 6, H - 6);
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
