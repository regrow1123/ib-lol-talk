// Game loop, UI binding
import { createGameState, getPlayerActions, processTurn, advanceToChoice, getSituationText } from './engine.js';

let state = null;

const $ = id => document.getElementById(id);

function init() {
  state = createGameState();
  // Init log toggle
  const logToggle = $('log-toggle');
  if (logToggle) {
    logToggle.onclick = () => {
      const content = $('log-content');
      content.classList.toggle('collapsed');
      $('log-arrow').textContent = content.classList.contains('collapsed') ? '▶' : '▼';
    };
  }
  // Clear log
  if ($('log-content')) $('log-content').innerHTML = '<div class="log-entry-start">⚔️ 라인전 시작</div>';
  renderAll();
}

function renderAll() {
  renderStatus();
  renderSituation();

  if (state.phase === 'choice') {
    renderChoices();
    $('result-panel').classList.add('hidden');
    $('choices-panel').classList.remove('hidden');
  } else if (state.phase === 'result') {
    renderResult();
    $('choices-panel').classList.add('hidden');
    $('result-panel').classList.remove('hidden');
  } else if (state.phase === 'gameover') {
    renderGameOver();
  }
}

function renderStatus() {
  // Player
  const p = state.player;
  const e = state.enemy;

  $('player-hp-bar').style.width = `${(p.hp / p.maxHp) * 100}%`;
  $('player-hp-text').textContent = `${Math.round(p.hp)} / ${p.maxHp}`;
  $('player-energy-bar').style.width = `${(p.energy / p.maxEnergy) * 100}%`;
  $('player-energy-text').textContent = `${Math.round(p.energy)} / ${p.maxEnergy}`;
  $('player-cs').textContent = p.cs;
  $('player-gold').textContent = p.gold;
  $('player-level').textContent = `Lv.${p.level}`;

  if (p.shield > 0) {
    $('player-shield-bar').style.width = `${(p.shield / p.maxHp) * 100}%`;
    $('player-shield-bar').classList.remove('hidden');
  } else {
    $('player-shield-bar').classList.add('hidden');
  }

  // Enemy
  $('enemy-hp-bar').style.width = `${(e.hp / e.maxHp) * 100}%`;
  $('enemy-hp-text').textContent = `${Math.round(e.hp)} / ${e.maxHp}`;
  $('enemy-energy-bar').style.width = `${(e.energy / e.maxEnergy) * 100}%`;
  $('enemy-energy-text').textContent = `${Math.round(e.energy)} / ${e.maxEnergy}`;
  $('enemy-cs').textContent = e.cs;
  $('enemy-gold').textContent = e.gold;
  $('enemy-level').textContent = `Lv.${e.level}`;

  if (e.shield > 0) {
    $('enemy-shield-bar').style.width = `${(e.shield / e.maxHp) * 100}%`;
    $('enemy-shield-bar').classList.remove('hidden');
  } else {
    $('enemy-shield-bar').classList.add('hidden');
  }

  // Cooldowns
  renderCooldowns(p, 'player');
  renderCooldowns(e, 'enemy');
}

function renderCooldowns(fighter, side) {
  const skills = ['Q', 'W', 'E', 'R'];
  for (const s of skills) {
    const el = $(`${side}-cd-${s.toLowerCase()}`);
    if (el) {
      const cd = fighter.cooldowns[s];
      if (cd > 0) {
        el.textContent = `${s}: ${cd}`;
        el.classList.add('on-cooldown');
      } else {
        el.textContent = `${s}`;
        el.classList.remove('on-cooldown');
      }
    }
  }
}

function renderSituation() {
  $('situation-text').textContent = getSituationText(state);
}

function renderChoices() {
  const actions = getPlayerActions(state);
  const container = $('choices-list');
  container.innerHTML = '';

  // Group actions by type
  const groups = { attack: [], cs: [], move: [], defense: [], debuff: [] };
  for (const a of actions) {
    (groups[a.type] || groups.attack).push(a);
  }

  const groupLabels = {
    attack: '⚔️ 공격',
    cs: '🪙 CS',
    move: '🏃 이동',
    defense: '🛡️ 방어',
    debuff: '💫 디버프',
  };

  for (const [type, acts] of Object.entries(groups)) {
    if (acts.length === 0) continue;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'action-group';

    const label = document.createElement('div');
    label.className = 'action-group-label';
    label.textContent = groupLabels[type] || type;
    groupDiv.appendChild(label);

    for (const action of acts) {
      const btn = document.createElement('button');
      btn.className = `choice-btn choice-${type}`;
      btn.textContent = action.text;
      btn.onclick = () => selectAction(action);
      groupDiv.appendChild(btn);
    }

    container.appendChild(groupDiv);
  }
}

function selectAction(action) {
  state = processTurn(state, action);
  renderAll();
}

function renderResult() {
  const container = $('result-narratives');
  container.innerHTML = '';

  // Show what enemy chose
  if (state.lastEnemyAction) {
    const enemyDiv = document.createElement('div');
    enemyDiv.className = 'enemy-action-reveal';
    enemyDiv.textContent = `적의 선택: ${state.lastEnemyAction.text}`;
    container.appendChild(enemyDiv);
  }

  for (const n of state.narratives) {
    const p = document.createElement('p');
    p.className = 'narrative';
    p.textContent = n;
    container.appendChild(p);
  }

  // Add to log
  appendToLog(state);

  $('next-turn-btn').onclick = () => {
    state = advanceToChoice(state);
    renderAll();
  };
}

function appendToLog(state) {
  const logContainer = $('log-content');
  if (!logContainer) return;

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const turnNum = state.turn - 1;
  const playerText = state.lastPlayerAction ? state.lastPlayerAction.text : '';
  const enemyText = state.lastEnemyAction ? state.lastEnemyAction.text : '';
  const results = state.narratives.join(' ');

  entry.innerHTML =
    `<span class="log-turn">[${turnNum}턴]</span> ` +
    `<span class="log-player-action">나: ${playerText}</span> | ` +
    `<span class="log-enemy-action">적: ${enemyText}</span><br>` +
    `<span class="log-result">→ ${results}</span>`;

  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function renderGameOver() {
  $('choices-panel').classList.add('hidden');
  $('result-panel').classList.add('hidden');
  $('gameover-panel').classList.remove('hidden');

  const msg = state.winner === 'player' ? '🏆 승리!' : '💀 패배...';
  $('gameover-text').textContent = msg;

  for (const n of state.narratives) {
    const p = document.createElement('p');
    p.className = 'narrative';
    $('gameover-narratives').appendChild(p);
    p.textContent = n;
  }

  $('restart-btn').onclick = () => {
    $('gameover-panel').classList.add('hidden');
    $('gameover-narratives').innerHTML = '';
    init();
  };
}

// Start
document.addEventListener('DOMContentLoaded', init);
