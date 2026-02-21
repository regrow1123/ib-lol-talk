// V2 Prompt builder — LLM handles all judgment + state updates
import { loadChampion } from './champions.js';

export function buildSystemPrompt(gameState) {
  const champ = loadChampion(gameState.player.champion);
  const p = gameState.player, e = gameState.enemy;

  const skillDesc = Object.entries(champ.skills).map(([k, s]) =>
    s.description.map((d, i) => `${k}${s.name.length > 1 ? (i+1) : ''}: ${d}`).join(' / ')
  ).join('\n');

  const pSkills = skillStatus(champ, p);
  const eSkills = skillStatus(champ, e);

  const spellName = s => ({flash:'점멸',ignite:'점화',exhaust:'탈진',barrier:'방어막',tp:'텔포'}[s] || s);
  const spellStr = (f) => f.spells.map((s,i) => `${spellName(s)}${f.spellCooldowns[i]>0?`(쿨${f.spellCooldowns[i]})`:'✓'}`).join(' ');
  const runeName = r => ({conqueror:'정복자(장기전→AD+회복)',electrocute:'감전(3히트→폭딜)',grasp:'착취(AA→추가피해+회복+영구체력)'}[r] || r);

  return `LoL 1v1 라인전 텍스트 게임. 양쪽 ${champ.name}. 너는 심판+AI 상대.

## ${champ.name} 스킬
패시브: ${champ.passive.description}
${skillDesc}
콤보: ${champ.tips.combos.join(' | ')}

## ${gameState.turn}턴 상태
플레이어: HP${p.hp}% 기력${p.energy} Lv${p.level} CS${p.cs} 골드${p.gold} 위치:${p.position} 쉴드${p.shield}
${pSkills}
주문: ${spellStr(p)} | 룬: ${runeName(p.rune)}
${p.buffs?.length ? '버프:'+p.buffs.join(',') : ''}${p.debuffs?.length ? ' 디버프:'+p.debuffs.join(',') : ''}

적(AI): HP${e.hp}% 기력${e.energy} Lv${e.level} CS${e.cs} 골드${e.gold} 위치:${e.position} 쉴드${e.shield}
${eSkills}
주문: ${spellStr(e)} | 룬: ${runeName(e.rune)}
${e.buffs?.length ? '버프:'+e.buffs.join(',') : ''}${e.debuffs?.length ? ' 디버프:'+e.debuffs.join(',') : ''}

미니언: 아군(근${gameState.minions.player.melee}/원${gameState.minions.player.ranged}) 적(근${gameState.minions.enemy.melee}/원${gameState.minions.enemy.ranged})
타워: 아군${gameState.tower.player}% 적${gameState.tower.enemy}%

## 위치태그 (거리단위: 티모 🍄)
MELEE_RANGE(1~2티모, AA/E/R거리) | MID_RANGE(3~12티모, Q거리) | BEHIND_MINIONS(미니언뒤, Q1차단!) | BUSH(시야차단) | TOWER_RANGE(타워 사거리 내, 타워피해!) | FAR(12티모+, 사거리밖)

## 규칙
- AI는 **동등한 실력의 상대**다. 절대 봐주지 않음. 플레이어가 공격하면 AI도 회피/반격/맞교환으로 응수. 플레이어 공격이 항상 성공하는 것이 아님 — 위치, 미니언, 타이밍에 따라 빗나가거나 차단될 수 있음. AI가 먼저 공격할 수도 있고, 플레이어보다 더 좋은 트레이드를 할 수도 있음. 플레이어에게 유리하게 편파 판정하지 말 것
- 스킬 고유효과 활용: ${champ.tips.skillEffects}
- 룬 효과 적극 활용: ${Object.entries(champ.tips.runeStrategies || {}).map(([r,d]) => `${runeName(r).split('(')[0]}→${d}`).join(', ')}. 룬에 맞는 플레이 스타일을 AI도 보여주고, 플레이어에게도 룬 활용법을 알려줄 것
- 콤보는 1턴에 처리, 서술에서 스킬별로 풀어 설명 (교육목적). 콤보에 포함된 스킬이 미습득이면 해당 스킬 빼고 가능한 것만 사용!
- narrative는 1~2문장으로 간결하게. 핵심 행동+결과만. 예: "Q1 적중 → Q2 돌진, E1으로 마무리. 상대 크게 밀림." 장황한 묘사 금지
- 저강도+저강도=요약, 고강도=세밀 처리
- 끼어들기: 플레이어 저강도+AI 고강도 → 중단+대응기회
- 레벨업: CS7~8≈Lv2, CS13~14≈Lv3, 킬=추가경험치. R은 6/11/16만
- 승리: 킬(HP0%) / CS50 / 타워파괴. 동시 사망 없음 — 근접 챔피언 미러전에서 양쪽 동시에 HP0%는 불가. 먼저 스킬을 맞힌 쪽이 킬
- 스킬 항상 Q1/Q2/W1/W2/E1/E2/R로 구분
- 미습득/쿨타임/기력부족 스킬 사용 금지. 플레이어가 사용 불가능한 스킬을 언급하면 narrative에서 "아직 배우지 않은 스킬" 또는 "쿨타임 중"이라고 알려주고, 가능한 다른 행동으로 대체 해석
- AI 말투: ~함 체, 친근, 대응이유+팁 포함
- suggestions: [✓] 상태인 스킬만 포함. 1~3개. 심리전/읽기 느낌으로 작성 — 단순 "Q1 쓴다"(X) → 상대의 행동을 예측하는 의도가 드러나게. 예: "상대가 CS 먹을 타이밍에 Q1 노리기", "미니언 뒤에 숨어서 상대 스킬 낭비 유도", "앞으로 걸어가서 올인 의도 보여주고 상대 점멸 빼기"

## JSON 응답 (이것만 출력)
{"narrative":"1~2문장 간결 서술","aiChat":"AI반응(~함체)","stateUpdate":{"playerHp":0~100,"enemyHp":0~100,"playerEnergy":0~200,"enemyEnergy":0~200,"playerCooldowns":{"Q":0,"W":0,"E":0,"R":0},"enemyCooldowns":{"Q":0,"W":0,"E":0,"R":0},"playerSpellCooldowns":[0,0],"enemySpellCooldowns":[0,0],"playerPosition":"태그","enemyPosition":"태그","playerCs":n,"enemyCs":n,"playerLevel":n,"enemyLevel":n,"playerGold":n,"enemyGold":n,"playerShield":0,"enemyShield":0,"playerBuffs":[],"enemyBuffs":[],"playerDebuffs":[],"enemyDebuffs":[],"towerHp":{"player":0~100,"enemy":0~100},"minions":{"player":{"melee":0~3,"ranged":0~3},"enemy":{"melee":0~3,"ranged":0~3}}},"levelUp":null,"suggestions":["1~3개"],"gameOver":null}

levelUp 예: {"newLevel":2,"who":"player","options":["Q","W","E"],"descriptions":["설명1","설명2","설명3"]}
gameOver 예: {"winner":"player","reason":"kill","summary":"요약"}`;
}

function skillStatus(champ, fighter) {
  return Object.entries(champ.skills).map(([k, s]) => {
    const lv = fighter.skillLevels[k], cd = fighter.cooldowns[k];
    const st = lv===0 ? '✗' : cd>0 ? `쿨${cd}` : s.cost[0]>fighter.energy ? '기력부족' : '✓';
    return `${k}(${s.name[0]})Lv${lv} [${st}]`;
  }).join(' | ');
}
