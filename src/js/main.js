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
  renderLaneCanvas();
}

function renderLaneCanvas() {
  const canvas = $('lane-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Lane background
  const laneY = H / 2;
  const laneTop = laneY - 12;
  const laneBot = laneY + 12;
  const margin = 40;
  const laneLeft = margin;
  const laneRight = W - margin;
  const laneW = laneRight - laneLeft;

  // Lane road
  ctx.fillStyle = '#1a2130';
  ctx.fillRect(laneLeft, laneTop, laneW, laneBot - laneTop);

  // Towers
  ctx.fillStyle = '#3498db';
  ctx.fillRect(laneLeft - 4, laneTop - 6, 16, laneBot - laneTop + 12);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(laneRight - 12, laneTop - 6, 16, laneBot - laneTop + 12);

  // Tower labels
  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#6b7d8f';
  ctx.textAlign = 'center';
  ctx.fillText('아군탑', laneLeft + 4, laneTop - 10);
  ctx.fillText('적탑', laneRight - 4, laneTop - 10);

  // Bush areas (above and below lane at center)
  const bushX = laneLeft + laneW * 0.45;
  const bushW = laneW * 0.1;
  ctx.fillStyle = 'rgba(46, 204, 113, 0.15)';
  ctx.fillRect(bushX, laneTop - 28, bushW, 20);
  ctx.fillRect(bushX, laneBot + 8, bushW, 20);
  ctx.fillStyle = '#2ecc7155';
  ctx.font = '8px sans-serif';
  ctx.fillText('부쉬', bushX + bushW / 2, laneTop - 16);
  ctx.fillText('부쉬', bushX + bushW / 2, laneBot + 22);

  // Position to X coordinate (0-4 lane positions)
  const posToX = (pos) => laneLeft + (pos / 4) * laneW;

  // Draw minions
  const drawMinions = (wave, color, yOffset) => {
    if (!wave) return;
    const alive = wave.filter(m => m.hp > 0);
    alive.forEach((m, i) => {
      const x = posToX(m.position ?? 2) + (i - alive.length / 2) * 6;
      const y = laneY + yOffset;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  };

  // Player minions (blue, slightly above center)
  drawMinions(state.minions.playerWave, '#3498db88', -4);
  // Enemy minions (red, slightly below center)
  drawMinions(state.minions.enemyWave, '#e74c3c88', 4);

  // Draw champions
  const drawChampion = (fighter, color, label) => {
    let x, y;
    if (fighter.inBush) {
      x = bushX + bushW / 2;
      y = laneTop - 20; // upper bush
    } else {
      x = posToX(fighter.position);
      y = laneY;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#f0e6d2';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#f0e6d2';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 3);
  };

  drawChampion(state.player, '#2980b9', '나');
  drawChampion(state.enemy, '#c0392b', '적');
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
