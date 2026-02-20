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
let mapBg = null;
const mapImg = new Image();
mapImg.src = 'img/midlane.png';
mapImg.onload = () => { mapBg = mapImg; renderCanvas(); };

function renderCanvas() {
  const canvas = $('lane-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background: midlane minimap image
  if (mapBg) {
    ctx.drawImage(mapBg, 0, 0, W, H);
    // Slight dark overlay for readability
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
  }

  // Grid → pixel mapping (champions move on 60x24 grid)
  const pad = 35;
  const gx = x => pad + (x/60) * (W - pad*2);
  const gy = y => 8 + (y/24) * (H - 16);

  // Tower indicators (subtle)
  const drawT = (x, y, col, lbl) => {
    const px = gx(x), py = gy(y);
    // Glow
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, px, py - 12);
  };
  drawT(3, 12, '#3498db', '아군 타워');
  drawT(57, 12, '#e74c3c', '적 타워');

  // Champions (circles with glow)
  const drawC = (f, col, lbl) => {
    const px = gx(f.x), py = gy(f.y);
    const r = 8;

    // Outer glow
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill
    ctx.fillStyle = col + '44';
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.fill();

    // HP arc
    const pct = f.hp / f.maxHp;
    const hpCol = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.strokeStyle = hpCol;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, r + 4, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, px, py + 3);
  };
  drawC(state.player, '#3498db', '나');
  drawC(state.enemy, '#e74c3c', '적');

  // Distance info
  const dist = Math.abs(state.player.x - state.enemy.x);
  const dl = dist <= 3 ? '근접' : dist <= 9 ? 'E사거리' : dist <= 24 ? 'Q사거리' : '원거리';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(W - 110, 2, 106, 16);
  ctx.fillStyle = '#ddd';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`거리 ${dist} (${dl})`, W - 6, 14);
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
