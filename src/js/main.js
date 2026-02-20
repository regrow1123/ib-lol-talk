// Game loop, UI binding - Grid System
import { createGameState, getPlayerActions, processTurn, advanceToChoice, getSituationText, hasSkillPoints, playerLevelUpSkill, getGridDistance } from './engine.js';
import { canLevelSkill } from './champion.js';

let state = null;

const $ = id => document.getElementById(id);

function init() {
  try {
  state = createGameState();
  console.log('Game state created:', state.phase, state.player.skillLevels);
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
  } catch(e) { console.error('INIT ERROR:', e); document.body.innerHTML = '<pre style="color:red;padding:20px;">INIT ERROR: ' + e.message + '\n' + e.stack + '</pre>'; }
}

function renderAll() {
  try { renderStatus(); } catch(e) { console.error('renderStatus:', e); }
  try { renderSituation(); } catch(e) { console.error('renderSituation:', e); }

  try {
    console.log('Phase:', state.phase);
    if (state.phase === 'skillup') {
      renderSkillUp();
      $('result-panel').classList.add('hidden');
      $('choices-panel').classList.remove('hidden');
    } else if (state.phase === 'choice') {
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
  } catch(e) {
    console.error('PHASE RENDER ERROR:', e);
    $('choices-list').innerHTML = `<pre style="color:red">${e.message}\n${e.stack}</pre>`;
    $('choices-panel').classList.remove('hidden');
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
      const lv = fighter.skillLevels[s];
      const cd = fighter.cooldowns[s];
      if (lv === 0) {
        el.textContent = `${s}`;
        el.classList.add('on-cooldown');
      } else if (cd > 0) {
        el.textContent = `${s}${lv}: ${cd}`;
        el.classList.add('on-cooldown');
      } else {
        el.textContent = `${s}${lv}`;
        el.classList.remove('on-cooldown');
      }
    }
  }
}

function renderSituation() {
  renderLaneCanvas();
}

// Grid to canvas coordinate conversion
function gridToCanvasX(gridX, canvasWidth) {
  const margin = 50;
  const laneLeft = margin;
  const laneRight = canvasWidth - margin;
  const laneW = laneRight - laneLeft;
  return laneLeft + (gridX / 60) * laneW;
}

function gridToCanvasY(gridY, canvasHeight) {
  const margin = 40;
  const laneTop = margin;
  const laneBottom = canvasHeight - margin;
  const laneH = laneBottom - laneTop;
  return laneTop + (gridY / 24) * laneH;
}

function renderLaneCanvas() {
  const canvas = $('lane-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const margin = 50;
  const laneLeft = margin;
  const laneRight = W - margin;
  const laneW = laneRight - laneLeft;
  const centerY = H / 2;

  // Ground / grass
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // River-ish edges
  ctx.fillStyle = '#111820';
  ctx.fillRect(0, gridToCanvasY(0, H), W, gridToCanvasY(6, H) - gridToCanvasY(0, H));
  ctx.fillRect(0, gridToCanvasY(18, H), W, gridToCanvasY(24, H) - gridToCanvasY(18, H));

  // Lane road (Y 6-18)
  ctx.fillStyle = '#1a2130';
  const roadTop = gridToCanvasY(6, H);
  const roadBottom = gridToCanvasY(18, H);
  const roadR = 4;
  ctx.beginPath();
  ctx.roundRect(laneLeft - 10, roadTop, laneW + 20, roadBottom - roadTop, roadR);
  ctx.fill();

  // Lane center line (faint)
  ctx.strokeStyle = '#2a354522';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  const centerLineY = gridToCanvasY(12, H);
  ctx.moveTo(laneLeft, centerLineY);
  ctx.lineTo(laneRight, centerLineY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw bushes
  const drawBush = (xMin, xMax, yMin, yMax, color) => {
    const x1 = gridToCanvasX(xMin, W);
    const x2 = gridToCanvasX(xMax, W);
    const y1 = gridToCanvasY(yMin, H);
    const y2 = gridToCanvasY(yMax, H);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x1, y1, x2 - x1, y2 - y1, 6);
    ctx.fill();
    
    // Bush texture
    ctx.fillStyle = color + '88';
    for (let i = 0; i < 8; i++) {
      const bx = x1 + Math.random() * (x2 - x1);
      const by = y1 + Math.random() * (y2 - y1);
      ctx.beginPath();
      ctx.arc(bx, by, 2 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Draw bushes (top and bottom)
  drawBush(18, 42, 2, 5, '#2d5016'); // Top bush
  drawBush(18, 42, 19, 22, '#2d5016'); // Bottom bush

  // Towers
  const drawTower = (gridX, gridY, color, label) => {
    const x = gridToCanvasX(gridX, W);
    const y = gridToCanvasY(gridY, H);
    
    // Base
    ctx.fillStyle = color + '44';
    ctx.fillRect(x - 12, y - 18, 24, 36);
    // Tower body
    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y - 14, 16, 28);
    ctx.fillStyle = color + 'aa';
    ctx.fillRect(x - 10, y - 16, 20, 4);
    // Label
    ctx.fillStyle = '#6b7d8f';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 25);
  };

  drawTower(3, 12, '#3498db', '아군 타워');
  drawTower(57, 12, '#e74c3c', '적 타워');

  // Draw minions scattered on grid
  const drawMinions = (wave, baseColor, side) => {
    if (!wave) return;
    const alive = wave.filter(m => m.hp > 0);

    alive.forEach((m, i) => {
      const x = gridToCanvasX(m.x, W);
      const y = gridToCanvasY(m.y, H);
      const isMelee = m.type === 'melee';
      const hpRatio = m.hp / m.maxHp;
      const size = isMelee ? 8 : 7;

      ctx.globalAlpha = 0.4 + hpRatio * 0.5;
      ctx.strokeStyle = m.hp <= 80 ? '#f1c40f' : baseColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - size/2, y - size/2, size, size);
      
      // Minion HP indicator
      if (m.hp <= 80) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.arc(x, y - size/2 - 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    });
  };

  drawMinions(state.minions.playerWave, '#e74c3c', 'enemy');
  drawMinions(state.minions.enemyWave, '#5dade2', 'player');

  // Draw champions
  const drawChampion = (fighter, color, darkColor, label) => {
    const x = gridToCanvasX(fighter.x, W);
    const y = gridToCanvasY(fighter.y, H);

    const size = 20;
    const half = size / 2;

    // Outer border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - half, y - half, size, size);

    // Inner fill
    ctx.fillStyle = darkColor;
    ctx.fillRect(x - half + 2, y - half + 2, size - 4, size - 4);

    // HP bar above
    const hpPct = fighter.hp / fighter.maxHp;
    const barW = size + 6;
    const barH = 4;
    const barX = x - barW / 2;
    const barY = y - half - 10;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // Shield bar (if active)
    if (fighter.shield > 0) {
      const shieldPct = fighter.shield / fighter.maxHp;
      ctx.fillStyle = '#3498db';
      ctx.fillRect(barX, barY - 2, barW * shieldPct, 1);
    }

    // Label
    ctx.fillStyle = '#f0e6d2';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 4);
    
    // Position coordinates (for debugging)
    ctx.fillStyle = '#888';
    ctx.font = '8px sans-serif';
    ctx.fillText(`(${fighter.x},${fighter.y})`, x, y + 16);
  };

  drawChampion(state.player, '#3498db', '#1a5276', '나');
  drawChampion(state.enemy, '#e74c3c', '#7b241c', '적');

  // Turn indicator
  ctx.fillStyle = '#c89b3c';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${state.turn}턴`, 8, 18);

  // Distance indicator
  const distance = getGridDistance(state.player, state.enemy);
  let distLabel = '원거리';
  if (distance <= 3) distLabel = '근접';
  else if (distance <= 9) distLabel = 'E사거리';
  else if (distance <= 24) distLabel = 'Q사거리';
  
  ctx.fillStyle = '#6b7d8f';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`거리: ${distance}칸 (${distLabel})`, W - 8, 18);

  // Grid overlay (for debugging - can be removed)
  if (false) { // Set to true for debugging
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= 60; x += 10) {
      const canvasX = gridToCanvasX(x, W);
      ctx.beginPath();
      ctx.moveTo(canvasX, 0);
      ctx.lineTo(canvasX, H);
      ctx.stroke();
    }
    for (let y = 0; y <= 24; y += 6) {
      const canvasY = gridToCanvasY(y, H);
      ctx.beginPath();
      ctx.moveTo(0, canvasY);
      ctx.lineTo(W, canvasY);
      ctx.stroke();
    }
  }
}

function renderSkillUp() {
  const container = $('choices-list');
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'action-group-label';
  header.textContent = `⬆️ 스킬 포인트 배분 (${state.player.skillPoints}포인트)`;
  container.appendChild(header);

  const skills = [
    { key: 'Q', name: '음파 / 공명타', desc: (lv) => `물리 피해 ${[55,80,105,130,155][lv]}(+115%추가AD)` },
    { key: 'W', name: '방호 / 철갑', desc: (lv) => `쉴드 ${[70,115,160,205,250][lv]}` },
    { key: 'E', name: '폭풍 / 쇠약', desc: (lv) => `마법 피해 ${[35,60,85,110,135][lv]}(+100%AD)` },
    { key: 'R', name: '용의 분노', desc: (lv) => `물리 피해 ${[175,400,625][lv]}(+200%추가AD)` },
  ];

  for (const s of skills) {
    const currentLv = state.player.skillLevels[s.key];
    const can = canLevelSkill(state.player, s.key);
    const btn = document.createElement('button');
    btn.className = `choice-btn choice-defense`;
    
    const lvText = `Lv.${currentLv}`;
    const nextDesc = can && currentLv < 5 ? ` → ${s.desc(currentLv)}` : '';
    btn.textContent = `${s.key} - ${s.name} [${lvText}]${nextDesc}`;
    
    if (!can) {
      btn.style.opacity = '0.3';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.onclick = () => {
        playerLevelUpSkill(state, s.key);
        renderAll();
      };
    }
    container.appendChild(btn);
  }
}

function renderChoices() {
  const actions = getPlayerActions(state);
  const container = $('choices-list');
  container.innerHTML = '';

  // Group actions by type
  const groups = { attack: [], cs: [], positioning: [], defense: [], utility: [], debuff: [] };
  for (const a of actions) {
    (groups[a.type] || groups.attack).push(a);
  }

  const groupLabels = {
    attack: '⚔️ 공격',
    cs: '🪙 CS',
    positioning: '🏃 포지셔닝',
    defense: '🛡️ 방어',
    utility: '🔧 유틸리티',
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