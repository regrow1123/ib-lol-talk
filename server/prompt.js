// Prompt builder — static/dynamic split for cache-friendly usage
import { loadChampion } from './champions.js';

export function buildPromptParts(gameState) {
  const champ = loadChampion(gameState.player.champion);
  const p = gameState.player, e = gameState.enemy;

  // === STATIC PROMPT (cacheable) ===
  const skillDesc = buildSkillDescription(champ);
  const rangeTable = buildRangeTable(champ);

  const staticPrompt = `LoL 1v1 라인전 텍스트 전략 게임. 양쪽 ${champ.name}. 너는 심판+AI 상대.

## ${champ.name} 스킬
패시브: ${champ.passive.description}
${skillDesc}

## 스킬 사거리
${rangeTable}
AA(기본공격): ${champ.baseStats.attackRange}

## recast 규칙
Q/W/E는 2단계 재사용 스킬. Q1→Q2는 Q라는 하나의 스킬의 2단 사용이지 별개 스킬이 아님.
1단계 사용 후 조건 충족 시 2단계 재사용 가능. 쿨다운은 최종 사용 후 시작.
R은 단일 스킬.

## 콤보
${champ.tips.combos.join('\n')}

## 거리 & 장애물
distance: 두 챔프 간 거리(유닛 숫자). 스킬 사거리와 비교하여 사용 가능 여부 판단.
blocked: true면 직선 경로에 미니언 존재 → 투사체(Q1) 차단. 범위기(E1)/대상지정(AA,R)은 무관.

## 규칙
- AI=동등한 상대. 봐주지않음. 회피/반격/맞교환 적극 응수
- 플레이어 공격이 항상 성공하는 것 아님. AI 선공 가능. 편파 판정 금지
- 다양한 스킬 조합/전략 적극 사용. 같은 패턴 반복 X → 플레이어가 여러 상황 경험
- narrative 1~2문장 간결. 스킬 효과 교육적으로 설명
- 저강도+저강도=요약 처리(CS 여러개 한번에), 고강도=세밀 처리
- 끼어들기: 플레이어 저강도 + AI 고강도 → 중단 + 대응 기회
- 승리: 킬(HP0) 또는 CS50. 동시사망 없음
- 미습득/쿨/자원부족 스킬 사용 금지
- aiChat 말투: ~했음/~됐음/~인듯/~ㅋㅋ (반말). 친근 + 대응 이유 + 팁
- suggestions: 스킬태그 포함 5~7개, 이모지 금지. 미습득 스킬 포함 OK.
  형식: [{"skill":"Q","text":"..."},{"skill":null,"text":"CS 챙기기"}]
  읽기/심리전 느낌 + 교육적 근거

## JSON 응답 (반드시 이 형식)
{"narrative":"","aiChat":"","actions":[{"who":"player/enemy","skill":"Q1/Q2/W1/AA/등","target":"enemy/player/minion","hit":true/false}],"distance":숫자,"blocked":true/false,"cs":{"player":0,"enemy":0},"enemySkillUp":null,"suggestions":[{"skill":"Q","text":"..."}],"gameOver":null}
gameOver 예: {"winner":"player","reason":"kill","summary":"요약"}
enemySkillUp: 적 레벨업 시 스킬 키 ("Q"/"W"/"E"/"R"), 없으면 null`;

  // === DYNAMIC PROMPT (changes every turn) ===
  const spellStr = (f) => f.spells.map((s, i) =>
    `${spellName(s)}${f.spellCooldowns[i] > 0 ? `(쿨${f.spellCooldowns[i]})` : '✓'}`
  ).join(' ');

  const pSkills = skillStatus(champ, p);
  const eSkills = skillStatus(champ, e);

  const dynamicPrompt = `## ${gameState.turn}턴 | 거리:${gameState.distance} | 장애물:${gameState.blocked ? '있음' : '없음'}
P: HP${p.hp}/${p.maxHp} ${p.resourceType}${p.resource}/${p.maxResource} Lv${p.level} CS${p.cs} AD${p.ad} 방${p.armor} 마저${p.mr} 쉴${p.shield} | ${pSkills} | ${spellStr(p)} | ${runeName(p.rune)}${p.buffs?.length ? ' 버프:' + p.buffs.join(',') : ''}${p.debuffs?.length ? ' 디:' + p.debuffs.join(',') : ''}
E: HP${e.hp}/${e.maxHp} ${e.resourceType}${e.resource}/${e.maxResource} Lv${e.level} CS${e.cs} AD${e.ad} 방${e.armor} 마저${e.mr} 쉴${e.shield} | ${eSkills} | ${spellStr(e)} | ${runeName(e.rune)}${e.buffs?.length ? ' 버프:' + e.buffs.join(',') : ''}${e.debuffs?.length ? ' 디:' + e.debuffs.join(',') : ''}
미니언: 아(근${gameState.minions.player.melee}/원${gameState.minions.player.ranged}) 적(근${gameState.minions.enemy.melee}/원${gameState.minions.enemy.ranged})`;

  return { staticPrompt, dynamicPrompt };
}

function buildSkillDescription(champ) {
  return Object.entries(champ.skills).map(([key, skill]) => {
    const descs = skill.description.map((d, i) => {
      const phase = skill.recast ? `${key}${i + 1}` : key;
      return `${phase}: ${d}`;
    }).join('\n');
    return descs;
  }).join('\n');
}

function buildRangeTable(champ) {
  return Object.entries(champ.skills).map(([key, skill]) => {
    if (skill.recast) {
      return skill.range.map((r, i) =>
        r > 0 ? `${key}${i + 1}: ${r}` : null
      ).filter(Boolean).join(' | ');
    }
    return `${key}: ${skill.range[0]}`;
  }).join('\n');
}

function skillStatus(champ, fighter) {
  return Object.entries(champ.skills).map(([k, s]) => {
    const lv = fighter.skillLevels[k], cd = fighter.cooldowns[k];
    const cost = s.cost[0] || 0;
    const st = lv === 0 ? '✗' : cd > 0 ? `쿨${cd}` : cost > fighter.resource ? '자원부족' : '✓';
    return `${k}Lv${lv}[${st}]`;
  }).join(' ');
}

function spellName(s) {
  return { flash: '점멸', ignite: '점화', exhaust: '탈진', barrier: '방어막', tp: '텔포' }[s] || s;
}

function runeName(r) {
  return {
    conqueror: '정복자',
    electrocute: '감전',
    grasp: '착취'
  }[r] || r;
}
