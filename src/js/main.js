// ib-lol talk V2 — KakaoTalk-style chat UI (refactored)
const $ = id => document.getElementById(id);
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn/14.20.1';

let state = null;
let sending = false;
let turnHistory = [];
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

    const spellNames = { flash: '점멸', ignite: '점화', exhaust: '탈진', barrier: '방어막', tp: '텔레포트' };
    const runeNames = { conqueror: '정복자', electrocute: '감전', grasp: '착취의 손아귀' };
    const spellText = setupChoices.spells.map(s => spellNames[s]).join(' + ');
    addSystemMsg(`📜 ${runeNames[setupChoices.rune]} | 🔮 ${spellText}`);
    addSystemMsg(data.narrative || '⚔️ 리신 vs 리신 — 라인전 시작!');
  } catch {
    addSystemMsg('⚠️ 서버 연결 실패');
    state = createFallbackState();
  }

  renderStatus();
  handlePhase(); // This will show skillup suggestions if needed
}

function createFallbackState() {
  const runes = ['conqueror', 'electrocute', 'grasp'];
  return {
    turn: 1, phase: 'skillup',
    player: {
      champion: 'lee-sin', hp: 100, maxHp: 100, energy: 200, maxEnergy: 200,
      cs: 0, gold: 0, level: 1, shield: 0,
      skillLevels: { Q: 0, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      skillPoints: 1, position: '중거리',
      spells: setupChoices.spells, spellCooldowns: [0, 0],
      rune: setupChoices.rune, buffs: [], debuffs: [],
    },
    enemy: {
      champion: 'lee-sin', hp: 100, maxHp: 100, energy: 200, maxEnergy: 200,
      cs: 0, gold: 0, level: 1, shield: 0,
      skillLevels: { Q: 1, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      skillPoints: 0, position: '중거리',
      spells: ['flash', 'ignite'], spellCooldowns: [0, 0],
      rune: runes[Math.floor(Math.random() * 3)], buffs: [], debuffs: [],
    },
    minions: { player: { melee: 3, ranged: 3 }, enemy: { melee: 3, ranged: 3 } },
    tower: { player: 100, enemy: 100 },
    winner: null,
  };
}

// ═══════════════════════════════════════
// Phase Handler (single source of truth)
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
    setInput(true);
  }
}

// ═══════════════════════════════════════
// Skill Level-Up (via suggestions area)
// ═══════════════════════════════════════
const SKILL_NAMES = { Q: '음파', W: '방호', E: '폭풍', R: '용의 분노' };

function showSkillUpChoices() {
  addSystemMsg('⬆️ 스킬을 선택하세요');
  const box = $('suggestions');
  box.innerHTML = '';

  const opts = ['Q', 'W', 'E'];
  if (state.player.level >= 6 && state.player.skillLevels.R < 1) opts.push('R');

  // Filter out maxed skills
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
  // Disable all skillup buttons immediately
  $('suggestions').querySelectorAll('.skillup-btn').forEach(b => { b.disabled = true; });

  try {
    const res = await fetch(`${API_BASE}/api/skillup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState: state, skill: key }),
    });
    const data = await res.json();
    if (data.error) {
      addSystemMsg(`⚠️ ${data.error}`);
      showSkillUpChoices(); // Re-show choices
      return;
    }
    if (data.state) state = data.state;
  } catch {
    // Fallback: client-side
    state.player.skillLevels[key]++;
    state.player.skillPoints--;
  }

  renderStatus();
  addSystemMsg(`${key} (${SKILL_NAMES[key]}) 스킬을 배웠습니다!`);

  // Check if more skill points remain
  if (state.player.skillPoints > 0) {
    showSkillUpChoices();
  } else {
    state.phase = 'play';
    // Show context-aware starting suggestions
    const learned = Object.entries(state.player.skillLevels).filter(([,v]) => v > 0).map(([k]) => k);
    const startSuggestions = [];
    if (learned.includes('Q')) startSuggestions.push('미니언 뒤에서 CS 먹으면서 Q 견제 노리기');
    if (learned.includes('W')) startSuggestions.push('안전하게 CS 챙기면서 상대 패턴 파악');
    if (learned.includes('E')) startSuggestions.push('가까이 붙어서 E로 짧은 교환 시도');
    if (!startSuggestions.length) startSuggestions.push('CS 먹으며 상대 움직임 관찰');
    renderSuggestions(startSuggestions);
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
      // Update history
      turnHistory.push({ role: 'user', content: input });
      turnHistory.push({ role: 'assistant', content: `${data.narrative || ''} | ${data.aiChat || ''}` });
      if (turnHistory.length > 12) turnHistory = turnHistory.slice(-12);

      // Render messages
      if (data.narrative) addSystemMsg(data.narrative);
      if (data.aiChat) addEnemyMsg(data.aiChat);

      // Update state
      if (data.state) state = data.state;
      renderStatus();

      // Handle result
      if (data.gameOver) {
        state.phase = 'gameover';
        state.winner = data.gameOver.winner;
        showGameOver(data.gameOver);
      } else if (data.levelUp && data.levelUp.who !== 'enemy') {
        // LLM returned levelUp → show skill choices (suggestions cleared by handlePhase)
        handlePhase();
      } else {
        state.phase = 'play';
        renderSuggestions(data.suggestions || []);
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
    btn.onclick = () => $('restart-btn').click();
    box.appendChild(btn);
  };
  $('restart-btn').onclick = () => {
    $('gameover-overlay').classList.add('hidden');
    $('chat-feed').innerHTML = '';
    state = null;
    turnHistory = [];
    setupChoices = { spells: [], rune: null };
    document.querySelectorAll('#spell-grid .spell-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('#rune-grid .rune-card').forEach(c => c.classList.remove('selected'));
    $('setup-start-btn').disabled = true;
    $('setup-start-btn').textContent = '게임 시작';
    $('setup-overlay').classList.remove('hidden');
    renderSuggestions([]);
  };
}

// ═══════════════════════════════════════
// Status Rendering
// ═══════════════════════════════════════
function renderStatus() {
  if (!state) return;
  const p = state.player, e = state.enemy;

  $('p-hp-fill').style.width = `${p.hp}%`;
  $('p-hp-text').textContent = `${Math.round(p.hp)}%`;
  $('p-energy-fill').style.width = `${(p.energy / 200) * 100}%`;
  $('p-energy-text').textContent = `${Math.round(p.energy)}`;
  $('p-cs').textContent = p.cs;
  $('p-gold').textContent = p.gold;
  $('p-level').textContent = `Lv.${p.level}`;
  renderCooldowns('p-cooldowns', p);
  renderRune('p-rune', p.rune);

  $('e-hp-fill').style.width = `${e.hp}%`;
  $('e-hp-text').textContent = `${Math.round(e.hp)}%`;
  $('e-energy-fill').style.width = `${(e.energy / 200) * 100}%`;
  $('e-energy-text').textContent = `${Math.round(e.energy)}`;
  $('e-cs').textContent = e.cs;
  $('e-gold').textContent = e.gold;
  $('e-level').textContent = `Lv.${e.level}`;
  renderCooldowns('e-cooldowns', e);
  renderRune('e-rune', e.rune);

  setHpColor('p-hp-fill', p.hp);
  setHpColor('e-hp-fill', e.hp);
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
// Cooldowns & Tooltips
// ═══════════════════════════════════════
const SKILL_DESC = {
  Q: ['Q1 음파: 직선 투사체(12티모🍄), 물리 피해 + 표식 3초. 미니언에 막힘', 'Q2 공명타: 표식 대상에게 돌진 + 물리 피해. 잃은 체력 비례 최대 2배'],
  W: ['W1 방호: 아군/미니언에게 돌진(7티모🍄) + 쉴드', 'W2 철갑: 생명력 흡수 + 주문 흡혈 증가'],
  E: ['E1 폭풍: 주변 원형(3.5티모🍄) 마법 피해 + 표식', 'E2 쇠약: 표식 대상 둔화'],
  R: ['R 용의 분노: 대상 넉백(4티모🍄) + 강한 물리 피해'],
};
const SPELL_DESC = {
  flash: '점멸: 즉시 짧은 거리 이동. 회피/기습용',
  ignite: '점화: 지속 피해 + 치유 감소. 킬각용',
  exhaust: '탈진: 둔화 + 피해 35% 감소. 올인 방어',
  barrier: '방어막: 즉시 보호막 생성',
  teleport: '텔레포트: 귀환 후 빠른 복귀',
};
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
  teleport: `${DDRAGON}/img/spell/SummonerTeleport.png`,
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
    el.onclick = () => showSkillTooltip(s, lv, cd);
    box.appendChild(el);
  }

  const spells = fighter.spells || [];
  const spellCds = fighter.spellCooldowns || [];
  for (let i = 0; i < spells.length; i++) {
    const cd = spellCds[i] || 0;
    const el = document.createElement('div');
    el.className = 'cd-icon cd-spell';
    el.innerHTML = `<img src="${SPELL_ICONS[spells[i]] || SPELL_ICONS.flash}" alt="${spells[i]}">`;
    if (cd > 0) { el.classList.add('cd-active'); el.innerHTML += `<div class="cd-overlay">${cd}</div>`; }
    else el.classList.add('cd-ready');
    const spellId = spells[i];
    el.onclick = () => showSpellTooltip(spellId, cd);
    box.appendChild(el);
  }
}

function showSkillTooltip(key, lv, cd) {
  const desc = SKILL_DESC[key];
  if (!desc) return;
  const status = lv === 0 ? '미습득' : cd > 0 ? `쿨타임 ${cd}턴` : '사용 가능';
  showTooltipPopup(`[${key} Lv.${lv}] ${status}\n${desc.join('\n')}`);
}

function showSpellTooltip(spellId, cd) {
  const desc = SPELL_DESC[spellId];
  if (!desc) return;
  showTooltipPopup(`[${cd > 0 ? `쿨타임 ${cd}턴` : '사용 가능'}] ${desc}`);
}

function showTooltipPopup(text) {
  let el = $('skill-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'skill-tooltip';
    el.className = 'skill-tooltip';
    el.onclick = () => el.classList.add('hidden');
    $('info-drawer').appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ═══════════════════════════════════════
// Suggestions
// ═══════════════════════════════════════
function renderSuggestions(suggestions) {
  const box = $('suggestions');
  box.innerHTML = '';
  for (const s of suggestions) {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = s;
    btn.onclick = () => {
      $('player-input').value = s;
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
