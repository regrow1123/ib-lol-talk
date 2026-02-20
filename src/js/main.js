// Game loop, UI binding
import { createGameState, getPlayerActions, processTurn, advanceToChoice, getSituationText } from './engine.js';

let state = null;

const $ = id => document.getElementById(id);

function init() {
  state = createGameState();
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

  // Position
  renderPositions();
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

function renderPositions() {
  const posEls = document.querySelectorAll('.lane-pos');
  posEls.forEach(el => {
    el.classList.remove('player-here', 'enemy-here');
  });

  const playerPosEl = $(`lane-${state.player.position}`);
  const enemyPosEl = $(`lane-${state.enemy.position}`);
  if (playerPosEl) playerPosEl.classList.add('player-here');
  if (enemyPosEl) enemyPosEl.classList.add('enemy-here');

  // Bush indicator
  $('player-bush')?.classList.toggle('active', state.player.inBush);
  $('enemy-bush')?.classList.toggle('active', state.enemy.inBush);
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

  $('next-turn-btn').onclick = () => {
    state = advanceToChoice(state);
    renderAll();
  };
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

// Log panel
function renderLog() {
  const container = $('log-content');
  if (!container) return;
  container.innerHTML = state.log.map(l =>
    `<div class="log-entry"><strong>${l.turn}턴</strong>: ${l.narratives.join(' | ')}</div>`
  ).join('');
}

// Start
document.addEventListener('DOMContentLoaded', init);
