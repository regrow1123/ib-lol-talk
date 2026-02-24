const IMG = '/src/img';
let CHAMPION_ID = 'lee-sin';

// ===== STATE =====
let gameState = null;
let championData = null;
let history = [];
let pendingEnemyAction = null;
let currentPlayerActions = [];
let selectedSpells = [];
let selectedRune = null;
let isLoading = false;

// ===== SPELL / RUNE DATA =====
const SPELLS = [
  { id: 'flash', name: '점멸', icon: 'SummonerFlash' },
  { id: 'ignite', name: '점화', icon: 'SummonerDot' },
  { id: 'exhaust', name: '탈진', icon: 'SummonerExhaust' },
  { id: 'barrier', name: '방벽', icon: 'SummonerBarrier' },
  { id: 'teleport', name: '텔레포트', icon: 'SummonerTeleport' },
];

const RUNES = [
  { id: 'conqueror', name: '정복자', icon: 'conqueror' },
  { id: 'electrocute', name: '감전', icon: 'electrocute' },
  { id: 'grasp', name: '착취', icon: 'grasp' },
];

const SKILL_ICONS = {
  Q: 'LeeSinQOne',
  W: 'LeeSinWOne',
  E: 'LeeSinEOne',
  R: 'LeeSinR',
};

// ===== DOM =====
const $setup = document.getElementById('setup-screen');
const $game = document.getElementById('game-screen');
const $spellSelect = document.getElementById('spell-select');
const $runeSelect = document.getElementById('rune-select');
const $startBtn = document.getElementById('start-btn');
const $playerStatus = document.getElementById('player-status');
const $enemyStatus = document.getElementById('enemy-status');
const $chatArea = document.getElementById('chat-area');
const $suggestions = document.getElementById('suggestions');
const $input = document.getElementById('player-input');
const $sendBtn = document.getElementById('send-btn');
const $overlay = document.getElementById('gameover-overlay');
const $gameoverTitle = document.getElementById('gameover-title');
const $gameoverSummary = document.getElementById('gameover-summary');
const $restartBtn = document.getElementById('restart-btn');
const $reviewBtn = document.getElementById('review-btn');

// ===== INIT =====
let championList = [];

async function init() {
  try {
    const listRes = await fetch('/data/champions/index.json');
    championList = await listRes.json();
  } catch (err) {
    console.error('[init] Failed to load champion list:', err);
  }
  renderSetup();
}

async function loadChampionData(id) {
  const res = await fetch(`/data/champions/${id}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  championData = await res.json();
  CHAMPION_ID = id;
}

function renderSetup() {
  const $champSelect = document.getElementById('champion-select');
  $champSelect.innerHTML = championList.map(c =>
    `<button class="champion-card${championList.length === 1 ? ' selected' : ''}" data-champ="${c.id}">
      <img src="${IMG}/champion/${c.icon}.png" alt="${c.name}">
      <span class="champ-name">${c.name}</span>
    </button>`
  ).join('');

  if (championList.length === 1) {
    CHAMPION_ID = championList[0].id;
  }

  $champSelect.addEventListener('click', e => {
    const btn = e.target.closest('[data-champ]');
    if (!btn) return;
    $champSelect.querySelectorAll('.champion-card').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    CHAMPION_ID = btn.dataset.champ;
    checkReady();
  });

  $spellSelect.innerHTML = SPELLS.map(s =>
    `<button class="icon-btn" data-spell="${s.id}" title="${s.name}">
      <img src="${IMG}/spell/${s.icon}.png" alt="${s.name}">
    </button>`
  ).join('');

  $spellSelect.addEventListener('click', e => {
    const btn = e.target.closest('[data-spell]');
    if (!btn) return;
    const id = btn.dataset.spell;
    if (selectedSpells.includes(id)) {
      selectedSpells = selectedSpells.filter(s => s !== id);
      btn.classList.remove('selected');
    } else if (selectedSpells.length < 2) {
      selectedSpells.push(id);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });

  $runeSelect.innerHTML = RUNES.map(r =>
    `<button class="icon-btn" data-rune="${r.id}" title="${r.name}">
      <img src="${IMG}/rune/${r.icon}.png" alt="${r.name}">
    </button>`
  ).join('');

  $runeSelect.addEventListener('click', e => {
    const btn = e.target.closest('[data-rune]');
    if (!btn) return;
    $runeSelect.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRune = btn.dataset.rune;
    updateStartBtn();
  });

  $startBtn.addEventListener('click', startGame);
  $restartBtn.addEventListener('click', () => { location.reload(); });
  $reviewBtn.addEventListener('click', () => {
    $overlay.classList.add('hidden');
    $chatArea.scrollTop = 0;
  });
}

function checkReady() { updateStartBtn(); }
function updateStartBtn() {
  $startBtn.disabled = !(CHAMPION_ID && selectedSpells.length === 2 && selectedRune);
}

// ===== GAME START =====
async function startGame() {
  $startBtn.disabled = true;
  $startBtn.textContent = '로딩 중...';
  try {
    await loadChampionData(CHAMPION_ID);
  } catch (err) {
    alert('챔피언 데이터 로드 실패: ' + err.message);
    $startBtn.disabled = false;
    $startBtn.textContent = '게임 시작';
    return;
  }

  const s = championData.baseStats;
  const createFighter = (spells, rune) => ({
    champion: CHAMPION_ID,
    hp: s.hp, maxHp: s.hp,
    resource: championData.resourceMax, maxResource: championData.resourceMax,
    resourceType: championData.resource,
    level: 1, cs: 0,
    ad: s.ad, baseAd: s.ad, armor: s.armor, mr: s.mr,
    skillLevels: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 1,
    cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
    shields: [],
    spells, spellCooldowns: [0, 0],
    rune,
  });

  const runes = ['conqueror', 'electrocute', 'grasp'];
  const spells = ['flash', 'ignite', 'exhaust', 'barrier', 'teleport'];
  const enemyRune = runes[Math.floor(Math.random() * runes.length)];
  const shuffled = [...spells].sort(() => Math.random() - 0.5);
  const enemySpells = shuffled.slice(0, 2);

  gameState = {
    phase: 'skillup',
    distance: 800,
    blocked: true,
    player: createFighter(selectedSpells, selectedRune),
    enemy: createFighter(enemySpells, enemyRune),
    minions: {
      player: { melee: 3, ranged: 3 },
      enemy: { melee: 3, ranged: 3 },
    },
    winner: null,
  };

  // Enemy auto skill-up at game start (first skill from champion data)
  const firstEnemySkill = championData.enemySkillOrder?.[0] || 'Q';
  gameState.enemy.skillLevels[firstEnemySkill] = 1;
  gameState.enemy.skillPoints = 0;

  $setup.classList.remove('active');
  $game.classList.add('active');

  renderStatus();
  addSystemMessage('라인전이 시작됩니다. 첫 스킬을 선택하세요.');
  showSkillUpUI();
}

// ===== STATUS RENDERING =====
function renderStatus() {
  renderFighterStatus($playerStatus, gameState.player, '나');
  renderFighterStatus($enemyStatus, gameState.enemy, '상대');
}

function renderFighterStatus(el, fighter, label) {
  const hpPct = Math.max(0, (fighter.hp / fighter.maxHp) * 100);
  const hpColor = hpPct > 50 ? 'var(--hp-green)' : 'var(--hp-red)';
  const portrait = `${IMG}/champion/LeeSin.png`;

  let cdHtml = '';
  for (const key of ['Q', 'W', 'E', 'R']) {
    const lv = fighter.skillLevels[key];
    const cd = fighter.cooldowns[key];
    const onCd = cd > 0;
    const iconName = SKILL_ICONS[key];
    const notLearned = lv === 0;
    cdHtml += `<div class="cd-icon ${onCd ? 'on-cd' : ''} ${notLearned ? 'not-learned' : ''}">
      <img src="${IMG}/spell/${iconName}.png" alt="${key}">
      ${onCd ? `<div class="cd-text">${Math.ceil(cd)}</div>` : ''}
    </div>`;
  }

  let spellCdHtml = '';
  for (let i = 0; i < fighter.spells.length; i++) {
    const spell = SPELLS.find(s => s.id === fighter.spells[i]);
    const cd = fighter.spellCooldowns[i];
    if (spell) {
      spellCdHtml += `<div class="cd-icon ${cd > 0 ? 'on-cd' : ''}">
        <img src="${IMG}/spell/${spell.icon}.png" alt="${spell.name}">
        ${cd > 0 ? `<div class="cd-text">${Math.ceil(cd)}</div>` : ''}
      </div>`;
    }
  }

  const runeInfo = RUNES.find(r => r.id === fighter.rune);
  const runeHtml = runeInfo ? `<div class="cd-icon rune-icon"><img src="${IMG}/rune/${runeInfo.icon}.png" alt="${runeInfo.name}"></div>` : '';

  el.innerHTML = `
    <div class="name-line">
      <img src="${portrait}" alt="${label}">
      <span>${label}</span>
      <span style="font-size:11px;color:#b2bec3">Lv${fighter.level}</span>
      ${runeInfo ? `<img class="rune-badge" src="${IMG}/rune/${runeInfo.icon}.png" alt="${runeInfo.name}">` : ''}
    </div>
    <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
    <div class="resource-bar"><div class="resource-fill" style="width:${Math.max(0, (fighter.resource / fighter.maxResource) * 100)}%"></div></div>
    <div class="stat-line">
      <span class="hp-text">${Math.round(fighter.hp)}/${fighter.maxHp}</span>
      <span style="color:var(--energy-yellow)">${Math.round(fighter.resource)}/${fighter.maxResource}</span>
      <span>CS ${fighter.cs}</span>
    </div>
    <div class="cd-icons">${cdHtml}${spellCdHtml}</div>
  `;
}

// ===== CHAT =====
function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.innerHTML = `<div class="bubble">${text}</div>`;
  $chatArea.appendChild(div);
  $chatArea.scrollTop = $chatArea.scrollHeight;
}

function addMyMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg mine';
  div.innerHTML = `<div class="bubble">${text}</div>`;
  $chatArea.appendChild(div);
  $chatArea.scrollTop = $chatArea.scrollHeight;
}

function addEnemyMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg enemy';
  div.innerHTML = `<div class="enemy-header"><img class="chat-portrait" src="${IMG}/champion/LeeSin.png" alt=""><span class="sender">${championData.name}</span></div><div class="bubble">${text}</div>`;
  $chatArea.appendChild(div);
  $chatArea.scrollTop = $chatArea.scrollHeight;
}

// ===== SKILLUP =====
function showSkillUpUI() {
  $input.disabled = true;
  $sendBtn.disabled = true;

  const buttons = [];
  for (const key of ['Q', 'W', 'E']) {
    const skill = championData.skills[key];
    const lv = gameState.player.skillLevels[key];
    const maxRank = skill.maxRank || 5;
    if (lv < maxRank) {
      const name = Array.isArray(skill.name) ? skill.name[0] : skill.name;
      buttons.push(`<button class="skillup-btn" data-skill="${key}">${key} - ${name}</button>`);
    }
  }

  const rSkill = championData.skills.R;
  if (rSkill && rSkill.unlockLevel && rSkill.unlockLevel.includes(gameState.player.level)) {
    const lv = gameState.player.skillLevels.R;
    if (lv < (rSkill.maxRank || 3)) {
      const name = Array.isArray(rSkill.name) ? rSkill.name[0] : rSkill.name;
      buttons.push(`<button class="skillup-btn" data-skill="R">R - ${name}</button>`);
    }
  }

  $suggestions.innerHTML = `<div class="skillup-row">${buttons.join('')}</div>`;
  $suggestions.querySelectorAll('.skillup-btn').forEach(btn => {
    btn.addEventListener('click', () => doSkillUp(btn.dataset.skill));
  });
}

async function doSkillUp(skill) {
  try {
    const res = await fetch('/api/skillup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState, skill }),
    });
    const data = await res.json();
    if (!data.ok) {
      addSystemMessage(`스킬 선택 실패: ${data.error}`);
      return;
    }

    gameState = data.state;
    renderStatus();

    const skillName = Array.isArray(championData.skills[skill].name)
      ? championData.skills[skill].name[0] : championData.skills[skill].name;
    addSystemMessage(`${skill} - ${skillName} 스킬을 배웠습니다.`);

    if (gameState.phase === 'skillup') {
      // More skill points available
      showSkillUpUI();
    } else {
      // phase === 'plan' → call plan API
      await callPlan();
    }
  } catch (err) {
    addSystemMessage('서버 오류가 발생했습니다.');
    console.error(err);
  }
}

// ===== PLAN =====
async function callPlan() {
  disableInput();
  $suggestions.innerHTML = '<span class="suggestion-chip loading">추천 행동 생성 중...</span>';

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameState, history }),
    });
    const data = await res.json();

    if (data.error) {
      addSystemMessage(`계획 오류: ${data.error}`);
      enableInput();
      return;
    }

    // Cache enemy action
    pendingEnemyAction = data.enemyAction;
    currentPlayerActions = data.playerActions || [];

    // Display player choices
    renderPlayerActions(currentPlayerActions);
    gameState.phase = 'play';
    enableInput();
  } catch (err) {
    addSystemMessage('서버 연결 오류. 다시 시도해주세요.');
    enableInput();
    console.error(err);
  }
}

// Build skill name → key map from champion data for display
function buildSkillNameMap() {
  const map = {};
  if (!championData?.skills) return map;
  for (const [key, skill] of Object.entries(championData.skills)) {
    const names = Array.isArray(skill.name) ? skill.name : [skill.name];
    names.forEach((n, i) => {
      map[n] = key + (names.length > 1 ? (i + 1) : '');
    });
  }
  return map;
}

function addSkillKeys(text) {
  const map = buildSkillNameMap();
  let result = text;
  // Sort by name length descending to avoid partial matches
  const sorted = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [name, code] of sorted) {
    result = result.replaceAll(name, `${name}(${code})`);
  }
  return result;
}

function renderPlayerActions(actions) {
  if (!actions || actions.length === 0) {
    $suggestions.innerHTML = '<span class="suggestion-chip" data-idx="0" data-text="CS 챙기기">CS 챙기기</span>';
  } else {
    $suggestions.innerHTML = actions.map((a, i) =>
      `<span class="suggestion-chip" data-idx="${i}" data-text="${escapeHtml(a.text)}">${escapeHtml(addSkillKeys(a.text))}</span>`
    ).join('');
  }

  $suggestions.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx);
      const action = currentPlayerActions[idx];
      if (action) {
        sendAction(action);
      } else {
        // Fallback: send as free text
        $input.value = chip.dataset.text;
        sendInput();
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== INPUT =====
function enableInput() {
  $input.disabled = false;
  $sendBtn.disabled = false;
  $input.focus();
}

function disableInput() {
  $input.disabled = true;
  $sendBtn.disabled = true;
}

$sendBtn.addEventListener('click', sendInput);
$input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) sendInput();
});

// Send a selected action (from plan choices)
async function sendAction(playerAction) {
  if (isLoading || !pendingEnemyAction) return;

  isLoading = true;
  disableInput();

  addMyMessage(playerAction.text);

  const loadingMsg = showLoadingBubble();

  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameState,
        playerAction,
        enemyAction: pendingEnemyAction,
        history,
      }),
    });
    const data = await res.json();
    loadingMsg.remove();

    if (data.error) {
      addSystemMessage(`오류: ${data.error}`);
      enableInput();
      isLoading = false;
      return;
    }

    handleTurnResult(data, playerAction.text);
  } catch (err) {
    loadingMsg.remove();
    addSystemMessage('서버 연결 오류. 다시 시도해주세요.');
    enableInput();
    console.error(err);
  }

  isLoading = false;
}

// Send free text input
async function sendInput() {
  const text = $input.value.trim();
  if (!text || isLoading || !pendingEnemyAction) return;

  isLoading = true;
  disableInput();
  $input.value = '';

  addMyMessage(text);

  const loadingMsg = showLoadingBubble();

  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameState,
        input: text,
        enemyAction: pendingEnemyAction,
        history,
      }),
    });
    const data = await res.json();
    loadingMsg.remove();

    if (data.error) {
      addSystemMessage(`오류: ${data.error}`);
      enableInput();
      isLoading = false;
      return;
    }

    handleTurnResult(data, text);
  } catch (err) {
    loadingMsg.remove();
    addSystemMessage('서버 연결 오류. 다시 시도해주세요.');
    enableInput();
    console.error(err);
  }

  isLoading = false;
}

function showLoadingBubble() {
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'msg enemy';
  loadingMsg.innerHTML = `<div class="enemy-header"><img class="chat-portrait" src="${IMG}/champion/LeeSin.png" alt=""><span class="sender">${championData.name}</span></div><div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  $chatArea.appendChild(loadingMsg);
  $chatArea.scrollTop = $chatArea.scrollHeight;
  return loadingMsg;
}

function handleTurnResult(data, playerText) {
  // Update state
  gameState = data.state;

  // Update history
  history.push({ role: 'user', content: playerText });
  history.push({
    role: 'assistant',
    content: JSON.stringify({
      narrative: data.narrative,
      aiChat: data.aiChat,
      actions: data.state._lastActions || [],
    }),
  });

  // Render
  if (data.narrative) addSystemMessage(data.narrative);
  if (data.aiChat) addEnemyMessage(data.aiChat);
  renderStatus();

  // Clear pending
  pendingEnemyAction = null;
  currentPlayerActions = [];

  // Game over?
  if (data.gameOver) {
    showGameOver(data.gameOver, data.tips);
    return;
  }

  // Level up?
  if (data.levelUp && data.levelUp.who === 'player') {
    addSystemMessage(`레벨 ${data.levelUp.newLevel}! 스킬을 선택하세요.`);
    showSkillUpUI();
    return;
  }

  // Normal: call plan for next turn
  callPlan();
}

// ===== GAME OVER =====
function showGameOver(gameOver, tips) {
  const isWin = gameOver.winner === 'player';
  $gameoverTitle.textContent = isWin ? '🎉 승리!' : '💀 패배';
  $gameoverSummary.textContent = gameOver.summary || '';

  const $tips = document.getElementById('gameover-tips');
  if (tips && tips.length > 0) {
    $tips.innerHTML = `<div class="tips-title">💡 이번 라인전 꿀팁</div>` +
      tips.map(t => `<div class="tip-item">${t}</div>`).join('');
  } else {
    $tips.innerHTML = '';
  }

  $overlay.classList.remove('hidden');
}

// ===== START =====
init();
