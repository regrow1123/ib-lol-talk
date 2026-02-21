// ib-lol talk V2 — KakaoTalk-style chat UI
const $ = id => document.getElementById(id);

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

let state = null;
let sending = false;
let turnHistory = [];
let setupChoices = { spells: [], rune: null };

// ── Setup Screen ──
function initSetup() {
  // Spell selection: pick 2 from 5
  document.querySelectorAll('#spell-grid .spell-card').forEach(el => {
    el.onclick = () => {
      const spell = el.dataset.spell;
      if (el.classList.contains('selected')) {
        el.classList.remove('selected');
        setupChoices.spells = setupChoices.spells.filter(s => s !== spell);
      } else {
        if (setupChoices.spells.length >= 2) {
          // Deselect first one
          const first = setupChoices.spells.shift();
          document.querySelector(`#spell-grid [data-spell="${first}"]`).classList.remove('selected');
        }
        setupChoices.spells.push(spell);
        el.classList.add('selected');
      }
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
    $('setup-overlay').classList.add('hidden');
  };
}

function updateStartBtn() {
  $('setup-start-btn').disabled = !(setupChoices.spells.length === 2 && setupChoices.rune);
}

// ── Game Start ──
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
    renderSuggestions(data.suggestions || []);
  } catch {
    addSystemMsg('⚠️ 서버 연결 실패');
    state = createFallbackState();
  }

  renderStatus();
  checkPhase();
}

function createFallbackState() {
  return {
    turn: 1, phase: 'skillup',
    player: {
      champion: 'lee-sin', hp: 100, maxHp: 100, energy: 200, maxEnergy: 200,
      cs: 0, gold: 0, level: 1, shield: 0,
      skillLevels: { Q: 0, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      skillPoints: 1, position: 'MID_RANGE',
      spells: setupChoices.spells, spellCooldowns: [0, 0],
      rune: setupChoices.rune, buffs: [], debuffs: [],
    },
    enemy: {
      champion: 'lee-sin', hp: 100, maxHp: 100, energy: 200, maxEnergy: 200,
      cs: 0, gold: 0, level: 1, shield: 0,
      skillLevels: { Q: 1, W: 0, E: 0, R: 0 }, cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      skillPoints: 0, position: 'MID_RANGE',
      spells: ['flash', 'ignite'], spellCooldowns: [0, 0],
      rune: 'conqueror', buffs: [], debuffs: [],
    },
    minions: { player: { melee: 3, ranged: 3 }, enemy: { melee: 3, ranged: 3 } },
    tower: { player: 100, enemy: 100 },
    winner: null,
  };
}

// ── Init ──
function init() {
  setInput(false);
  initSetup();

  $('send-btn').onclick = submit;
  $('player-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
}

// ── Submit Turn ──
async function submit() {
  if (sending || !state || state.phase !== 'play') return;
  const input = $('player-input').value.trim();
  if (!input) return;

  sending = true;
  $('player-input').value = '';
  $('suggestions').innerHTML = '';
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
      if (turnHistory.length > 10) turnHistory = turnHistory.slice(-10);

      if (data.narrative) addSystemMsg(data.narrative);
      if (data.aiChat) addEnemyMsg(data.aiChat);

      if (data.state) state = data.state;
      renderSuggestions(data.suggestions || []);
      renderStatus();

      if (data.gameOver) {
        state.phase = 'gameover';
        state.winner = data.gameOver.winner;
        showGameOver(data.gameOver);
      } else if (data.levelUp && data.levelUp.who !== 'enemy') {
        checkPhase();
      } else {
        state.phase = 'play';
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

// ── Messages ──
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

// ── Phase Check ──
function checkPhase() {
  if (!state) return;
  if (state.phase === 'skillup' && state.player.skillPoints > 0) {
    showSkillUp();
    setInput(false);
  } else if (state.phase === 'gameover') {
    setInput(false);
  } else {
    state.phase = 'play';
    setInput(true);
    $('skillup-overlay').classList.add('hidden');
  }
}

// ── Skill Up ──
async function showSkillUp() {
  const overlay = $('skillup-overlay');
  const box = $('skillup-buttons');
  box.innerHTML = '';
  overlay.classList.remove('hidden');

  const skills = [
    { key: 'Q', name: '음파/공명타', desc: ['Lv1: 55dmg', 'Lv2: 80dmg', 'Lv3: 105dmg', 'Lv4: 130dmg', 'Lv5: 155dmg'] },
    { key: 'W', name: '방호/철갑', desc: ['Lv1: 쉴드70', 'Lv2: 쉴드115', 'Lv3: 쉴드160', 'Lv4: 쉴드205', 'Lv5: 쉴드250'] },
    { key: 'E', name: '폭풍/쇠약', desc: ['Lv1: 35+AD', 'Lv2: 60+AD', 'Lv3: 85+AD', 'Lv4: 110+AD', 'Lv5: 135+AD'] },
    { key: 'R', name: '용의 분노', desc: ['Lv1: 175dmg', 'Lv2: 400dmg', 'Lv3: 625dmg'] },
  ];

  for (const s of skills) {
    const lv = state.player.skillLevels[s.key];
    const maxLv = s.key === 'R' ? 3 : 5;
    const canLevel = lv < maxLv && state.player.skillPoints > 0;
    const rBlock = s.key === 'R' && ![6, 11, 16].includes(state.player.level);

    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    const nextDesc = lv < s.desc.length ? s.desc[lv] : 'MAX';
    btn.textContent = `${s.key} — ${s.name}  [Lv.${lv}] → ${nextDesc}`;
    btn.disabled = !canLevel || rBlock;

    if (canLevel && !rBlock) {
      btn.onclick = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/skillup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameState: state, skill: s.key }),
          });
          const data = await res.json();
          if (data.state) state = data.state;
          renderStatus();
          addSystemMsg(`${s.key} (${s.name}) 스킬을 배웠습니다!`);
          if (state.player.skillPoints <= 0) {
            overlay.classList.add('hidden');
            state.phase = 'play';
            setInput(true);
          } else {
            showSkillUp();
          }
        } catch {
          // Fallback: client-side
          state.player.skillLevels[s.key]++;
          state.player.skillPoints--;
          renderStatus();
          addSystemMsg(`${s.key} (${s.name}) 스킬을 배웠습니다!`);
          if (state.player.skillPoints <= 0) {
            overlay.classList.add('hidden');
            state.phase = 'play';
            setInput(true);
          } else {
            showSkillUp();
          }
        }
      };
    }
    box.appendChild(btn);
  }
}

// ── Game Over ──
function showGameOver(gameOver) {
  $('gameover-overlay').classList.remove('hidden');
  $('gameover-title').textContent = gameOver.winner === 'player' ? '🏆 승리!' : '💀 패배...';
  $('gameover-summary').textContent = gameOver.summary || '';
  $('review-btn').onclick = () => {
    $('gameover-overlay').classList.add('hidden');
    // 채팅 로그 복기 가능, 입력은 비활성화 유지
    setInput(false);
  };
  $('restart-btn').onclick = () => {
    $('gameover-overlay').classList.add('hidden');
    $('chat-feed').innerHTML = '';
    state = null;
    turnHistory = [];
    setupChoices = { spells: [], rune: null };
    // Reset setup UI
    document.querySelectorAll('#spell-grid .spell-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('#rune-grid .rune-card').forEach(c => c.classList.remove('selected'));
    $('setup-start-btn').disabled = true;
    $('setup-start-btn').textContent = '게임 시작';
    $('setup-overlay').classList.remove('hidden');
  };
}

// ── Status Rendering ──
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

  $('e-hp-fill').style.width = `${e.hp}%`;
  $('e-hp-text').textContent = `${Math.round(e.hp)}%`;
  $('e-energy-fill').style.width = `${(e.energy / 200) * 100}%`;
  $('e-energy-text').textContent = `${Math.round(e.energy)}`;
  $('e-cs').textContent = e.cs;
  $('e-gold').textContent = e.gold;
  $('e-level').textContent = `Lv.${e.level}`;
  renderCooldowns('e-cooldowns', e);

  $('turn-text').textContent = `${state.turn}턴`;

  // HP bar color
  setHpColor('p-hp-fill', p.hp);
  setHpColor('e-hp-fill', e.hp);
}

function setHpColor(id, hp) {
  const el = $(id);
  if (hp <= 25) el.style.background = 'linear-gradient(90deg, #c0392b, #e74c3c)';
  else if (hp <= 50) el.style.background = 'linear-gradient(90deg, #e67e22, #f39c12)';
  else el.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
}

const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn/14.20.1';
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

  const skills = ['Q', 'W', 'E', 'R'];
  for (const s of skills) {
    const lv = fighter.skillLevels?.[s] || 0;
    const cd = fighter.cooldowns?.[s] || 0;
    const el = document.createElement('div');
    el.className = 'cd-icon';
    el.innerHTML = `<img src="${SKILL_ICONS[s]}" alt="${s}">`;
    if (lv === 0) {
      el.classList.add('cd-locked');
    } else if (cd > 0) {
      el.classList.add('cd-active');
      el.innerHTML += `<div class="cd-overlay">${cd}</div>`;
    } else {
      el.classList.add('cd-ready');
    }
    el.onclick = () => showSkillTooltip(s, lv, cd);
    box.appendChild(el);
  }

  const spells = fighter.spells || [];
  const spellCds = fighter.spellCooldowns || [];
  for (let i = 0; i < spells.length; i++) {
    const cd = spellCds[i] || 0;
    const el = document.createElement('div');
    el.className = 'cd-icon cd-spell';
    const icon = SPELL_ICONS[spells[i]] || SPELL_ICONS.flash;
    el.innerHTML = `<img src="${icon}" alt="${spells[i]}">`;
    if (cd > 0) {
      el.classList.add('cd-active');
      el.innerHTML += `<div class="cd-overlay">${cd}</div>`;
    } else {
      el.classList.add('cd-ready');
    }
    const spellId = spells[i];
    el.onclick = () => showSpellTooltip(spellId, cd);
    box.appendChild(el);
  }
}

// ── Skill/Spell Tooltip ──
function showSkillTooltip(key, lv, cd) {
  const desc = SKILL_DESC[key];
  if (!desc) return;
  const status = lv === 0 ? '미습득' : cd > 0 ? `쿨타임 ${cd}턴` : '사용 가능';
  const text = `[${key} Lv.${lv}] ${status}\n${desc.join('\n')}`;
  showTooltipPopup(text);
}

function showSpellTooltip(spellId, cd) {
  const desc = SPELL_DESC[spellId];
  if (!desc) return;
  const status = cd > 0 ? `쿨타임 ${cd}턴` : '사용 가능';
  showTooltipPopup(`[${status}] ${desc}`);
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

// ── Suggestions ──
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

document.addEventListener('DOMContentLoaded', init);
