// V2 Prompt builder — LLM handles all judgment + state updates
import { loadChampion } from './champions.js';

// Returns { staticPrompt, dynamicPrompt } for cache-friendly usage
export function buildPromptParts(gameState) {
  const champ = loadChampion(gameState.player.champion);
  const p = gameState.player, e = gameState.enemy;

  const skillDesc = Object.entries(champ.skills).map(([k, s]) =>
    s.description.map((d, i) => `${k}${s.name.length > 1 ? (i+1) : ''}: ${d}`).join(' / ')
  ).join('\n');

  const spellName = s => ({flash:'점멸',ignite:'점화',exhaust:'탈진',barrier:'방어막',tp:'텔포'}[s] || s);
  const spellStr = (f) => f.spells.map((s,i) => `${spellName(s)}${f.spellCooldowns[i]>0?`(쿨${f.spellCooldowns[i]})`:'✓'}`).join(' ');
  const runeName = r => ({conqueror:'정복자(장기전→AD+회복)',electrocute:'감전(3히트→폭딜)',grasp:'착취(AA→추가피해+회복+영구체력)'}[r] || r);

  const pSkills = skillStatus(champ, p);
  const eSkills = skillStatus(champ, e);

  // Static: champion data + rules (cacheable, ~80% of tokens)
  const staticPrompt = `LoL 1v1 라인전 텍스트 게임. 양쪽 ${champ.name}. 너는 심판+AI 상대.

## ${champ.name} 스킬
패시브: ${champ.passive.description}
${skillDesc}
콤보: ${champ.tips.combos.join(' | ')}

## 위치태그 (티모 🍄)
근접(1~2,AA/E/R) | 중거리(3~12,Q) | 미니언뒤(Q1차단) | 수풀(시야X) | 타워사거리(타워피해) | 원거리(12+,사거리밖)

## 규칙
- AI=동등한 상대. 봐주지않음. 회피/반격/맞교환 응수. 플레이어 공격 항상 성공X. AI 선공 가능. 편파판정 금지
- 스킬효과: ${champ.tips.skillEffects}
- 룬활용: ${Object.entries(champ.tips.runeStrategies || {}).map(([r,d]) => `${runeName(r).split('(')[0]}→${d}`).join(', ')}
- 콤보 1턴처리, 스킬별 설명(교육). 미습득 스킬은 빼고 사용
- narrative 1~2문장. 핵심만. 장황X
- 저강도+저강도=요약, 고강도=세밀
- 끼어들기: 플레이어저강도+AI고강도→중단+대응기회
- 레벨업: CS7~8≈Lv2, CS13~14≈Lv3, 킬=추가경험치. R은6/11/16만
- 승리: 킬(HP0%)/CS50/타워파괴. 동시사망없음—먼저 맞힌쪽이 킬
- 스킬표기: Q1/Q2/W1/W2/E1/E2/R
- 미습득/쿨/기력부족 사용금지. 불가능스킬→알려주고 대체행동
- 상대방(aiChat) 말투: 문장 끝을 ~했음/~됐음/~인듯/~ㅋㅋ 등 반말 종결. 예: "잘 피했음", "그거 좀 아팠음 ㅋㅋ", "CS 먹을 타이밍에 Q 노리는 거 좋았음", "다음엔 W 쉴드 먼저 쓰는 게 나을듯". "체"라는 글자를 붙이지 말 것. 친근+대응이유+팁. "AI"표현금지→"상대방"
- suggestions: [✓]스킬만, 1~3개. 상황맞게(HP높→공격, HP낮→방어, 쿨중→CS). 읽기/심리전느낌(상대행동예측). 교육적근거포함. 중복금지

## JSON응답만 출력
{"narrative":"","aiChat":"~함체","stateUpdate":{"playerHp":0~100,"enemyHp":0~100,"playerEnergy":0~200,"enemyEnergy":0~200,"playerCooldowns":{"Q":0,"W":0,"E":0,"R":0},"enemyCooldowns":{"Q":0,"W":0,"E":0,"R":0},"playerSpellCooldowns":[0,0],"enemySpellCooldowns":[0,0],"playerPosition":"태그","enemyPosition":"태그","playerCs":n,"enemyCs":n,"playerLevel":n,"enemyLevel":n,"playerGold":n,"enemyGold":n,"playerShield":0,"enemyShield":0,"playerBuffs":[],"enemyBuffs":[],"playerDebuffs":[],"enemyDebuffs":[],"towerHp":{"player":0~100,"enemy":0~100},"minions":{"player":{"melee":0~3,"ranged":0~3},"enemy":{"melee":0~3,"ranged":0~3}}},"levelUp":null,"suggestions":[],"gameOver":null}
levelUp예: {"newLevel":2,"who":"player","options":["Q","W","E"],"descriptions":["설명1","설명2","설명3"]}
gameOver예: {"winner":"player","reason":"kill","summary":"요약"}`;

  // Dynamic: current turn state (changes every turn)
  const dynamicPrompt = `## ${gameState.turn}턴
P: HP${p.hp}% 기${p.energy} Lv${p.level} CS${p.cs} G${p.gold} ${p.position} 쉴${p.shield} | ${pSkills} | ${spellStr(p)} | ${runeName(p.rune)}${p.buffs?.length ? ' 버프:'+p.buffs.join(',') : ''}${p.debuffs?.length ? ' 디:'+p.debuffs.join(',') : ''}
E: HP${e.hp}% 기${e.energy} Lv${e.level} CS${e.cs} G${e.gold} ${e.position} 쉴${e.shield} | ${eSkills} | ${spellStr(e)} | ${runeName(e.rune)}${e.buffs?.length ? ' 버프:'+e.buffs.join(',') : ''}${e.debuffs?.length ? ' 디:'+e.debuffs.join(',') : ''}
미니언: 아(근${gameState.minions.player.melee}/원${gameState.minions.player.ranged}) 적(근${gameState.minions.enemy.melee}/원${gameState.minions.enemy.ranged}) | 타워: 아${gameState.tower.player}% 적${gameState.tower.enemy}%`;

  return { staticPrompt, dynamicPrompt };
}

// Legacy wrapper (kept for compatibility)

function skillStatus(champ, fighter) {
  return Object.entries(champ.skills).map(([k, s]) => {
    const lv = fighter.skillLevels[k], cd = fighter.cooldowns[k];
    const st = lv===0 ? '✗' : cd>0 ? `쿨${cd}` : s.cost[0]>fighter.energy ? '기력부족' : '✓';
    return `${k}(${s.name[0]})Lv${lv} [${st}]`;
  }).join(' | ');
}
