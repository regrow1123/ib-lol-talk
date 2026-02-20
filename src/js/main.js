// Game loop, UI binding
import { createGameState, getPlayerActions, processTurn, advanceToChoice, getSituationText, hasSkillPoints, playerLevelUpSkill } from './engine.js';
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

// Seeded random for consistent minion scatter per turn
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
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
  const laneY = H / 2;
  const laneHalfH = 30; // lane is 60px tall

  // Ground / grass
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // River-ish edges
  ctx.fillStyle = '#111820';
  ctx.fillRect(0, laneY - laneHalfH - 40, W, 40);
  ctx.fillRect(0, laneY + laneHalfH, W, 40);

  // Lane road
  ctx.fillStyle = '#1a2130';
  const roadR = 4;
  ctx.beginPath();
  ctx.roundRect(laneLeft - 10, laneY - laneHalfH, laneW + 20, laneHalfH * 2, roadR);
  ctx.fill();

  // Lane center line (faint)
  ctx.strokeStyle = '#2a354522';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(laneLeft, laneY);
  ctx.lineTo(laneRight, laneY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Towers
  const drawTower = (x, color, label) => {
    // Base
    ctx.fillStyle = color + '44';
    ctx.fillRect(x - 10, laneY - laneHalfH - 5, 20, laneHalfH * 2 + 10);
    // Tower body
    ctx.fillStyle = color;
    ctx.fillRect(x - 6, laneY - 14, 12, 28);
    ctx.fillStyle = color + 'aa';
    ctx.fillRect(x - 8, laneY - 16, 16, 4);
    // Label
    ctx.fillStyle = '#6b7d8f';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, laneY - laneHalfH - 12);
  };

  drawTower(laneLeft - 5, '#3498db', '아군 타워');
  drawTower(laneRight + 5, '#e74c3c', '적 타워');

  // Position to X coordinate (0-4)
  const posToX = (pos) => laneLeft + 20 + (pos / 4) * (laneW - 40);

  // Draw minions scattered naturally
  const rng = seededRandom(state.turn * 7 + 31);
  const drawMinions = (wave, baseColor, side) => {
    if (!wave) return;
    const alive = wave.filter(m => m.hp > 0);
    const clashX = posToX(2); // minions clash at center

    alive.forEach((m, i) => {
      const isMelee = m.type === 'melee';
      const xOffset = (side === 'player' ? -1 : 1) * (isMelee ? 8 + rng() * 12 : 22 + rng() * 16);
      const yOffset = (rng() - 0.5) * (laneHalfH * 1.2);
      const x = clashX + xOffset;
      const y = laneY + yOffset;

      const hpRatio = m.hp / m.maxHp;
      const size = isMelee ? 8 : 7;

      ctx.globalAlpha = 0.4 + hpRatio * 0.5;
      ctx.strokeStyle = m.hp <= 80 ? '#f1c40f' : baseColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - size/2, y - size/2, size, size);

      ctx.globalAlpha = 1;
    });
  };

  drawMinions(state.minions.playerWave, '#5dade2', 'player');
  drawMinions(state.minions.enemyWave, '#e74c3c', 'enemy');

  // Draw champions
  const drawChampion = (fighter, color, darkColor, label) => {
    const x = posToX(fighter.position);
    const y = laneY;

    const size = 18;
    const half = size / 2;

    // Outer border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - half, y - half, size, size);

    // HP bar above
    const hpPct = fighter.hp / fighter.maxHp;
    const barW = size + 4;
    const barH = 3;
    const barX = x - barW / 2;
    const barY = y - half - 7;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // Label
    ctx.fillStyle = '#f0e6d2';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 3);
  };

  drawChampion(state.player, '#3498db', '#1a5276', '나');
  drawChampion(state.enemy, '#e74c3c', '#7b241c', '적');

  // Turn indicator
  ctx.fillStyle = '#c89b3c';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${state.turn}턴`, 8, 16);

  // Distance indicator
  const dist = Math.abs(state.player.position - state.enemy.position);
  const distLabel = dist <= 1 ? '근접' : dist <= 2 ? 'Q사거리' : '원거리';
  ctx.fillStyle = '#6b7d8f';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`거리: ${dist}칸 (${distLabel})`, W - 8, 16);
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
