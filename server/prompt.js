import { loadChampion } from './champions.js';

// ===== Helpers =====

function skillName(k, champ) {
  const s = champ.skills[k];
  if (!s) return k;
  const n = Array.isArray(s.name) ? s.name[0] : s.name;
  return `${n}(${k})`;
}

function fmtSkills(fighter, champ) {
  return ['Q', 'W', 'E', 'R'].map(k => {
    const lv = fighter.skillLevels[k];
    const cd = fighter.cooldowns[k];
    const cost = champ.skills[k]?.cost?.[0] || 0;
    const name = skillName(k, champ);
    if (!lv) return `${name}✗`;
    if (cd > 0) return `${name}Lv${lv}[쿨${Math.round(cd)}s]`;
    if (cost > fighter.resource) return `${name}Lv${lv}[자원부족]`;
    return `${name}Lv${lv}✓`;
  }).join(' ');
}

function fmtSpells(f) {
  const names = { flash:'점멸', ignite:'점화', exhaust:'탈진', barrier:'방벽', teleport:'텔포' };
  return f.spells.map((s, i) =>
    f.spellCooldowns[i] > 0 ? `${names[s]||s}(${Math.round(f.spellCooldowns[i])}s)` : `${names[s]||s}✓`
  ).join(' ');
}

function fmtShields(f) {
  if (!f.shields?.length) return '';
  return ' 쉴드:' + f.shields.map(s => `${s.source}:${Math.round(s.amount)}`).join(',');
}

const RUNE_NAME = { conqueror:'정복자', electrocute:'감전', grasp:'착취' };

function stateBlock(state, champ) {
  const p = state.player, e = state.enemy;
  return `거리:${state.distance} 장애물:${state.blocked ? 'O' : 'X'}
P HP${p.hp}/${p.maxHp} 기력${p.resource}/${p.maxResource} Lv${p.level} CS${p.cs} AD${p.ad} 방${p.armor} 마저${p.mr} | ${fmtSkills(p, champ)} | ${fmtSpells(p)} | ${RUNE_NAME[p.rune]}${fmtShields(p)}
E HP${e.hp}/${e.maxHp} 기력${e.resource}/${e.maxResource} Lv${e.level} CS${e.cs} AD${e.ad} 방${e.armor} 마저${e.mr} | ${fmtSkills(e, champ)} | ${fmtSpells(e)} | ${RUNE_NAME[e.rune]}${fmtShields(e)}${e.skillPoints > 0 ? ' SP:'+e.skillPoints : ''}
미니언: 아군(근${state.minions.player.melee}원${state.minions.player.ranged}) 적(근${state.minions.enemy.melee}원${state.minions.enemy.ranged})`;
}

// ===== Core rules (minimal — Claude knows LoL) =====

const GAME_RULES = `## 우리 게임 규칙 (LoL 지식은 이미 있으니 게임 특수 규칙만)

스킬 표기: 모든 곳에서 스킬 이름 사용 (음파, 공명타격, 방호, 철갑, 폭풍, 쇠약, 용의 분노, 기본공격).
recast: 1단계(음파/방호/폭풍) 적중 후 같은 턴에 2단계(공명타격/철갑/쇠약) 연계 가능. 쿨다운은 1단계 사용 시 시작.

elapsed (턴 시간 규모):
- instant(1s) / short(3s) / medium(6s) / long(10s) / very_long(15s)
- 교전 강도에 맞게 선택. 양쪽 저강도면 long/very_long, 교전이면 instant/short.

숫자 금지: 피해량·HP 수치를 narrative/aiChat에 절대 쓰지 마. 서버가 계산함.
CS: 이번 턴 추가량만 (누적 아님). 레벨업 테이블: 4→Lv2, 10→Lv3, 18→Lv4, 27→Lv5, 37→Lv6, 48→Lv7.
적 스킬업: 서버가 자동 처리 (프롬프트에서 결정 불필요).`;

// ===== Plan prompt =====

export function buildPlanPrompt(gameState) {
  const champ = loadChampion(gameState.player.champion);

  const staticPrompt = `${champ.name} 미러매치 1v1 라인전. 너는 양쪽 전략 플래너.

${GAME_RULES}

## 출력
플레이어 행동 3개 (우선순위순) + 적 행동 1개 (최선).
행동 텍스트: 1인칭 구어체 ("Q1 꽂아볼까", "CS 먹으면서 기다리자"). 근거 포함. 이모지 금지.

JSON만 출력:
{
  "playerActions": [
    {"skills":["음파"],"target":"enemy","requires":"Q","text":"행동+근거"},
    {"skills":[],"target":null,"requires":null,"text":"행동+근거"},
    {"skills":["방호"],"target":"self","requires":"W","text":"행동+근거"}
  ],
  "enemyAction": {"skills":["음파"],"target":"player","text":"행동+근거"},
}`;

  return { staticPrompt, dynamicPrompt: stateBlock(gameState, champ) };
}

// ===== Resolve prompt =====

export function buildResolvePrompt(gameState, playerAction, enemyAction, isFreeText) {
  const champ = loadChampion(gameState.player.champion);

  const staticPrompt = `${champ.name} 미러매치 1v1 라인전 심판. 양쪽 행동이 정해졌고, 결과를 판정해.

${GAME_RULES}

## aiChat
적 챔피언의 올챗. 반말(~했음/~인듯/~ㅋㅋ). 도발·인정·놀림·카운터 설명 자연스럽게. 1~2문장.

## narrative
턴 결과 보고. 묘사·비유 금지, 팩트만. "음파 적중" "회피" "CS 2개 수급" 식으로. 1~3문장.

JSON만 출력:
{
  "narrative": "나레이션",
  "aiChat": "적 올챗",
  "actions": [{"who":"player"|"enemy","skill":"음파"|"공명타격"|"방호"|"철갑"|"폭풍"|"쇠약"|"용의 분노"|"기본공격","target":"enemy","hit":true}],
  "elapsed": "short",
  "distance": 숫자,
  "blocked": bool,
  "cs": {"player":0,"enemy":0},
  "minions": {"player":{"melee":3,"ranged":3},"enemy":{"melee":3,"ranged":3}},
}`;

  const state = stateBlock(gameState, champ);

  let actionCtx;
  if (isFreeText) {
    actionCtx = `플레이어 입력: "${playerAction}"
적 확정 행동: ${enemyAction.text} (스킬: ${enemyAction.skills?.join('+') || 'none'})
플레이어 의도를 해석해서 적 행동과 함께 판정해. 입력이 행동이 아니어도 적 행동은 실행됨.`;
  } else {
    actionCtx = `플레이어 선택: ${playerAction.text} (스킬: ${playerAction.skills?.join('+') || 'none'})
적 확정 행동: ${enemyAction.text} (스킬: ${enemyAction.skills?.join('+') || 'none'})
동시 실행. 결과 판정해.`;
  }

  return { staticPrompt, dynamicPrompt: state, actionContext: actionCtx };
}
