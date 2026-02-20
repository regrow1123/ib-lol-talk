// ib-lol talk — KakaoTalk-style chat UI
const $ = id => document.getElementById(id);

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';

let gameId = null;
let state = null;
let sending = false;
let drawerOpen = false;
let setupChoices = { spell: null, rune: null };

// ── Setup Screen ──
function initSetup() {
  const overlay = $('setup-overlay');

  // Spell selection (flash is locked, pick second)
  document.querySelectorAll('#spell-grid .spell-card:not(.locked)').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('#spell-grid .spell-card:not(.locked)').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      setupChoices.spell = el.dataset.spell;
      updateStartBtn();
    };
  });

  // Rune selection
  document.querySelectorAll('#rune-grid .rune-card').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('#rune-grid .rune-card').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      setupChoices.rune = el.dataset.rune;
      updateStartBtn();
    };
  });

  $('setup-start-btn').onclick = async () => {
    $('setup-start-btn').disabled = true;
    $('setup-start-btn').textContent = '로딩...';
    await startGame();
    overlay.classList.add('hidden');
  };
}

function updateStartBtn() {
  $('setup-start-btn').disabled = !(setupChoices.spell && setupChoices.rune);
}

// ── Init ──
async function startGame() {
  // Start new game via server
  try {
    const res = await fetch(`${API_BASE}/api/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spell: setupChoices.spell,
        rune: setupChoices.rune,
      }),
    });
    const data = await res.json();
    gameId = data.gameId;
    state = data.state;

    // Store player choices in state
    state.playerSetup = { ...setupChoices };

    const spellNames = { ignite: '점화', exhaust: '탈진', barrier: '방어막', tp: '순간이동' };
    const runeNames = { conqueror: '정복자', electrocute: '감전', grasp: '착취의 손아귀' };
    addSystemMsg(`📜 ${runeNames[setupChoices.rune]} | ⚡점멸 + ${spellNames[setupChoices.spell]}`);
    addSystemMsg(data.narrative || '⚔️ 리신 vs 리신 — 라인전 시작');
  } catch {
    addSystemMsg('⚠️ 서버 연결 실패 — 로컬 모드로 진행합니다');
    gameId = null;
    // Fallback local state
    state = {
      turn: 0, phase: 'skillup',
      player: { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,shield:0,
                skillLevels:{Q:0,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:1 },
      enemy:  { hp:645,maxHp:645,energy:200,maxEnergy:200,cs:0,gold:0,level:1,shield:0,
                skillLevels:{Q:1,W:0,E:0,R:0},cooldowns:{Q:0,W:0,E:0,R:99},skillPoints:0 },
    };
    state.playerSetup = { ...setupChoices };
  }

  renderStatus();
  checkPhase();
}

function init() {
  setInput(false);
  initSetup();

  $('send-btn').onclick = submit;
  $('player-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  $('info-toggle').onclick = () => {
    drawerOpen = !drawerOpen;
    $('info-drawer').classList.toggle('hidden', !drawerOpen);
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
  if (sending || !state || state.phase !== 'play') return;
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
    const res = await fetch(`${API_BASE}/api/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState: state, input }),
    });
    const data = await res.json();
    typing.remove();

    if (data.error) {
      addSystemMsg(`⚠️ ${data.error}`);
    } else {
      if (data.narrative) addSystemMsg(data.narrative);
      if (data.enemyAction) addEnemyMsg(data.enemyAction);
      if (data.state) state = data.state;
      renderStatus();
      checkPhase();
    }
  } catch {
    typing.remove();
    addSystemMsg('⚠️ 서버 오류가 발생했습니다');
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
  if (!state) return;
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
    state = null;
    $('setup-overlay').classList.remove('hidden');
    $('setup-start-btn').disabled = false;
    $('setup-start-btn').textContent = '게임 시작';
  };
}

// ── Status ──
function renderStatus() {
  if (!state) return;
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

document.addEventListener('DOMContentLoaded', init);
