// ib-lol talk — Clean rewrite
const $ = id => document.getElementById(id);
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn/14.20.1';

let state = null;
let sending = false;
let turnHistory = [];
let allSuggestions = [];
let setupChoices = { spells: [], rune: null };

// ═══════════════════════════════════════
// Setup Screen
// ═══════════════════════════════════════
function initSetup() {
  document.querySelectorAll('#spell-grid .spell-card').forEach(el => {
    el.onclick = () => {
      const spell = el.dataset.spell;
      if (el.classList.contains('selected')) {
        el.classList.remove('selected');
        setupChoices.spells = setupChoices.spells.filter(s => s !== spell);
      } else {
        if (setupChoices.spells.length >= 2) {
          const first = setupChoices.spells.shift();
          document.querySelector(`#spell-grid [data-spell="${first}"]`).classList.remove('selected');
        }
        setupChoices.spells.push(spell);
        el.classList.add('selected');
      }
      updateStartBtn();
    };
  });

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
    $('setup-overlay').classList.add('hidden');
  };
}

function updateStartBtn() {
  $('setup-start-btn').disabled = !(setupChoices.spells.length === 2 && setupChoices.rune);
}

// ═══════════════════════════════════════
// Game Start
// ═══════════════════════════════════════
async function startGame() {
  try {
    const res = await fetch(`${API_BASE}/api/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spells: setupChoices.spells, rune: setupChoices.rune }),
    });
    const data = await res.json();
    state = data.state;
    allSuggestions = data.suggestions || [];

    const spellNames = { flash: '점멸', ignite: '점화', exhaust: '탈진', barrier: '방어막', tp: '텔레포트' };
    const runeNames = { conqueror: '정복자', electrocute: '감전', grasp: '착취의 손아귀' };
    addSystemMsg(`📜 ${runeNames[setupChoices.rune]} | 🔮 ${setupChoices.spells.map(s => spellNames[s]).join(' + ')}`);
    addSystemMsg(data.narrative || '⚔️ 라인전 시작!');
  } catch {
    addSystemMsg('⚠️ 서버 연결 실패');
  }

  renderStatus();
  handlePhase();
}

// ═══════════════════════════════════════
// Phase Handler
// ═══════════════════════════════════════
function handlePhase() {
  if (!state) return;

  if (state.phase === 'skillup' && state.player.skillPoints > 0) {
    setInput(false);
    showSkillUpChoices();
  } else if (state.phase === 'gameover') {
    setInput(false);
  } else {
    state.phase = 'play';
    renderSuggestions(allSuggestions);
    setInput(true);
  }
}

// ═══════════════════════════════════════
// Skill Level-Up
// ═══════════════════════════════════════
const SKILL_NAMES = { Q: '음파', W: '방호', E: '폭풍', R: '용의 분노' };

function showSkillUpChoices() {
  addSystemMsg('⬆️ 스킬을 선택하세요');
  const box = $('suggestions');
  box.innerHTML = '';

  const opts = ['Q', 'W', 'E'];
  if (state.player.level >= 6 && state.player.skillLevels.R < 1) opts.push('R');

  const available = opts.filter(k => {
    const maxLv = k === 'R' ? 3 : 5;
    return state.player.skillLevels[k] < maxLv;
  });

  for (const key of available) {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn skillup-btn';
    const lv = state.player.skillLevels[key];
    btn.textContent = `${key} ${SKILL_NAMES[key]} (Lv${lv}→${lv + 1})`;
    btn.onclick = () => doSkillUp(key);
    box.appendChild(btn);
  }
}

async function doSkillUp(key) {
  $('suggestions').querySelectorAll('.skillup-btn').forEach(b => { b.disabled = true; });

  let skillupData = null;
  try {
    const res = await fetch(`${API_BASE}/api/skillup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState: state, skill: key }),
    });
    skillupData = await res.json();
    if (skillupData.error) {
      addSystemMsg(`⚠️ ${skillupData.error}`);
      showSkillUpChoices();
      return;
    }
    if (skillupData.state) state = skillupData.state;
  } catch {
    state.player.skillLevels[key]++;
    state.player.skillPoints--;
  }

  renderStatus();
  addSystemMsg(`${key} (${SKILL_NAMES[key]}) 스킬을 배웠습니다!`);

  if (state.player.skillPoints > 0) {
    showSkillUpChoices();
  } else {
    state.phase = 'play';
    renderSuggestions(allSuggestions);
    setInput(true);
    $('player-input').focus();
  }
}

// ═══════════════════════════════════════
// Submit Turn
// ═══════════════════════════════════════
async function submit() {
  if (sending || !state || state.phase !== 'play') return;
  const input = $('player-input').value.trim();
  if (!input) return;

  sending = true;
  $('player-input').value = '';
  renderSuggestions([]);
  setInput(false);
  addMyMsg(input);

  const typing = addTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/api/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState: state, input, history: turnHistory }),
    });
    const data = await res.json();
    typing.remove();

    if (data.error) {
      addSystemMsg(`⚠️ ${data.error}`);
    } else {
      turnHistory.push({ role: 'user', content: input });
      turnHistory.push({ role: 'assistant', content: `${data.narrative || ''} | ${data.aiChat || ''}` });
      if (turnHistory.length > 12) turnHistory = turnHistory.slice(-12);

      if (data.narrative) addSystemMsg(data.narrative);
      if (data.aiChat) addEnemyMsg(data.aiChat);

      if (data.state) state = data.state;
      renderStatus();

      if (data.gameOver) {
        state.phase = 'gameover';
        state.winner = data.gameOver.winner;
        showGameOver(data.gameOver);
      } else if (data.levelUp && data.levelUp.who !== 'enemy') {
        allSuggestions = data.suggestions || [];
        handlePhase();
      } else {
        state.phase = 'play';
        allSuggestions = data.suggestions || [];
        renderSuggestions(allSuggestions);
        setInput(true);
      }
    }
  } catch {
    typing.remove();
    addSystemMsg('⚠️ 서버 오류가 발생했습니다');
  }

  sending = false;
  if (state?.phase === 'play') {
    setInput(true);
    $('player-input').focus();
  }
}

// ═══════════════════════════════════════
// Messages
// ═══════════════════════════════════════
function addMyMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg me';
  div.innerHTML = `<div class="msg-time">${timeStr()}</div><div class="msg-body"><div class="bubble">${esc(text)}</div></div>`;
  feed.appendChild(div);
  scrollBottom();
}

function addEnemyMsg(text) {
  const feed = $('chat-feed');
  const div = document.createElement('div');
  div.className = 'msg them';
  div.innerHTML = `
    <div class="msg-avatar enemy-avatar"><img src="${DDRAGON}/img/champion/LeeSin.png" alt="리신"></div>
    <div class="msg-body">
      <div class="msg-name">상대방</div>
      <div class="bubble">${esc(text)}</div>
    </div>
    <div class="msg-time">${timeStr()}</div>`;
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
    <div class="msg-avatar enemy-avatar"><img src="${DDRAGON}/img/champion/LeeSin.png" alt="리신"></div>
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

function setInput(on) {
  $('player-input').disabled = !on;
  $('send-btn').disabled = !on;
}

// ═══════════════════════════════════════
// Game Over
// ═══════════════════════════════════════
function showGameOver(gameOver) {
  $('gameover-overlay').classList.remove('hidden');
  $('gameover-title').textContent = gameOver.winner === 'player' ? '🏆 승리!' : '💀 패배...';
  $('gameover-summary').textContent = gameOver.summary || '';
  $('review-btn').onclick = () => {
    $('gameover-overlay').classList.add('hidden');
    setInput(false);
    const box = $('suggestions');
    box.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = '🔄 새 게임 시작';
    btn.onclick = () => location.reload();
    box.appendChild(btn);
  };
  $('restart-btn').onclick = () => location.reload();
}

// ═══════════════════════════════════════
// Status Rendering
// ═══════════════════════════════════════
function renderStatus() {
  if (!state) return;
  const p = state.player, e = state.enemy;

  // HP bars (percentage for width, actual values for text)
  const pHpPct = (p.hp / p.maxHp) * 100;
  const eHpPct = (e.hp / e.maxHp) * 100;
  $('p-hp-fill').style.width = `${pHpPct}%`;
  $('p-hp-text').textContent = `${p.hp} / ${p.maxHp}`;
  $('e-hp-fill').style.width = `${eHpPct}%`;
  $('e-hp-text').textContent = `${e.hp} / ${e.maxHp}`;

  // Resource bars
  const pResPct = (p.resource / p.maxResource) * 100;
  const eResPct = (e.resource / e.maxResource) * 100;
  $('p-energy-fill').style.width = `${pResPct}%`;
  $('p-energy-text').textContent = `${Math.round(p.resource)}`;
  $('e-energy-fill').style.width = `${eResPct}%`;
  $('e-energy-text').textContent = `${Math.round(e.resource)}`;

  // Stats
  $('p-cs').textContent = p.cs;
  $('p-gold').textContent = p.gold;
  $('p-level').textContent = `Lv.${p.level}`;
  $('e-cs').textContent = e.cs;
  $('e-gold').textContent = e.gold;
  $('e-level').textContent = `Lv.${e.level}`;

  renderCooldowns('p-cooldowns', p);
  renderCooldowns('e-cooldowns', e);
  renderRune('p-rune', p.rune);
  renderRune('e-rune', e.rune);

  setHpColor('p-hp-fill', pHpPct);
  setHpColor('e-hp-fill', eHpPct);
}

const RUNE_INFO = {
  conqueror: { name: '정복자', img: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/Conqueror/Conqueror.png' },
  electrocute: { name: '감전', img: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png' },
  grasp: { name: '착취', img: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png' },
};

function renderRune(elId, rune) {
  const el = $(elId);
  if (!el || !rune) return;
  const info = RUNE_INFO[rune];
  if (!info) { el.innerHTML = ''; return; }
  el.innerHTML = `<img src="${info.img}" class="rune-status-icon" alt="${info.name}"><span class="rune-status-name">${info.name}</span>`;
}

function setHpColor(id, hp) {
  const el = $(id);
  if (hp <= 25) el.style.background = 'linear-gradient(90deg, #c0392b, #e74c3c)';
  else if (hp <= 50) el.style.background = 'linear-gradient(90deg, #e67e22, #f39c12)';
  else el.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
}

// ═══════════════════════════════════════
// Cooldowns
// ═══════════════════════════════════════
const SKILL_ICONS = {
  Q: `${DDRAGON}/img/spell/LeeSinQOne.png`,
  W: `${DDRAGON}/img/spell/LeeSinWOne.png`,
  E: `${DDRAGON}/img/spell/LeeSinEOne.png`,
  R: `${DDRAGON}/img/spell/LeeSinR.png`,
};
const SPELL_ICONS = {
  flash: `${DDRAGON}/img/spell/SummonerFlash.png`,
  ignite: `${DDRAGON}/img/spell/SummonerDot.png`,
  exhaust: `${DDRAGON}/img/spell/SummonerExhaust.png`,
  barrier: `${DDRAGON}/img/spell/SummonerBarrier.png`,
  tp: `${DDRAGON}/img/spell/SummonerTeleport.png`,
};

function renderCooldowns(containerId, fighter) {
  const box = $(containerId);
  box.innerHTML = '';

  for (const s of ['Q', 'W', 'E', 'R']) {
    const lv = fighter.skillLevels?.[s] || 0;
    const cd = fighter.cooldowns?.[s] || 0;
    const el = document.createElement('div');
    el.className = 'cd-icon';
    el.innerHTML = `<img src="${SKILL_ICONS[s]}" alt="${s}">`;
    if (lv === 0) el.classList.add('cd-locked');
    else if (cd > 0) { el.classList.add('cd-active'); el.innerHTML += `<div class="cd-overlay">${cd}</div>`; }
    else el.classList.add('cd-ready');
    box.appendChild(el);
  }

  const spells = fighter.spells || [];
  const spellCds = fighter.spellCooldowns || [];
  for (let i = 0; i < spells.length; i++) {
    const cd = spellCds[i] || 0;
    const el = document.createElement('div');
    el.className = 'cd-icon cd-spell';
    el.innerHTML = `<img src="${SPELL_ICONS[spells[i]] || ''}" alt="${spells[i]}">`;
    if (cd > 0) { el.classList.add('cd-active'); el.innerHTML += `<div class="cd-overlay">${cd}</div>`; }
    else el.classList.add('cd-ready');
    box.appendChild(el);
  }
}

// ═══════════════════════════════════════
// Suggestions
// ═══════════════════════════════════════
function filterSuggestions(suggestions) {
  if (!state) return suggestions;
  const p = state.player;
  return suggestions.filter(s => {
    if (!s.skill) return true;
    const key = s.skill.toUpperCase();
    if (['Q', 'W', 'E', 'R'].includes(key)) {
      return p.skillLevels[key] > 0 && p.cooldowns[key] <= 0;
    }
    return true;
  });
}

function renderSuggestions(suggestions) {
  const box = $('suggestions');
  box.innerHTML = '';
  const filtered = filterSuggestions(suggestions);
  for (const s of filtered.slice(0, 3)) {
    const text = typeof s === 'string' ? s : s.text;
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = text;
    btn.onclick = () => {
      $('player-input').value = text;
      submit();
    };
    box.appendChild(btn);
  }
}

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════
function init() {
  setInput(false);
  initSetup();
  $('send-btn').onclick = submit;
  $('player-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
