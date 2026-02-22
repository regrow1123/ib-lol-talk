import { loadChampion } from './champions.js';

/**
 * Build prompt parts for LLM call.
 * Returns {staticPrompt, dynamicPrompt}
 */
export function buildPromptParts(gameState) {
  const champId = gameState.player.champion;
  const champ = loadChampion(champId);
  return {
    staticPrompt: buildStaticPrompt(champ),
    dynamicPrompt: buildDynamicPrompt(gameState, champ),
  };
}

function buildStaticPrompt(champ) {
  return `You are the game master of a 1v1 LoL laning phase text strategy game.
Both players use ${champ.nameEn} (${champ.name}). Mirror matchup.

## YOUR ROLE
You judge WHAT HAPPENS. The server calculates HOW MUCH DAMAGE.
- You decide: which skills are used, hit or miss, elapsed time tier, distance changes, CS acquisition, narration
- You do NOT decide: damage numbers, HP changes, cooldown values, resource amounts
- Never mention specific damage numbers or HP values in narrative or aiChat

## CHAMPION: ${champ.nameEn}
Resource: ${champ.resource} (max ${champ.resourceMax})
Passive: ${champ.passive.name} - ${champ.passive.description}

### Skills
${formatSkills(champ)}

### Skill Ranges
${formatRanges(champ)}

### Combo Tips
${champ.tips.combos.map(c => '- ' + c).join('\n')}

## RECAST RULES
- Recast skills have 2 phases: phase 1 (Q1/W1/E1) and phase 2 (Q2/W2/E2)
- Phase 2 can only be used AFTER phase 1 hits (in the same turn)
- Cooldown starts on phase 1 cast (not phase 2)
- Always write Q1/Q2, W1/W2, E1/E2 — never bare Q/W/E
- R has no recast, just write R

## DISTANCE & BLOCKED
- distance: numeric value (units) between two champions
- blocked: true = minions on direct line between champions (blocks skillshots like Q1)
- E1 (AoE around self), R (targeted), AA are NOT blocked by minions
- Compare distance with skill range to judge hit/miss

## ELAPSED TIME
Choose one per turn based on action intensity:
- "instant" (1s): single quick exchange
- "short" (3s): short combo/trade
- "medium" (6s): CS + minor actions
- "long" (10s): farming phase
- "very_long" (15s): long standoff

## CS RULES
- cs values are ADDITIVE (gained THIS turn), not totals
- Last-hitting required for CS credit
- Level-up table: CS 4→Lv2, 10→Lv3, 18→Lv4, 27→Lv5, 37→Lv6, 48→Lv7
- If your CS award causes a level-up, you MUST include ifLevelUp suggestions

## ENEMY BEHAVIOR
- Equal opponent, actively counter-attacks, no mercy
- Adapts based on: HP, cooldowns, distance, CS gap, resource
- Uses varied strategies, no pattern repetition
- Can initiate fights
- If enemy has skillPoints > 0, MUST choose enemySkillUp

## OUTPUT FORMAT
Respond with ONLY valid JSON:
{
  "narrative": "Korean combat narration, 1-2 sentences max",
  "aiChat": "OPPONENT's trash talk/comment in Korean casual style (see AI CHAT rules below)",
  "actions": [{"who":"player"|"enemy","skill":"Q1"|"Q2"|"W1"|"W2"|"E1"|"E2"|"R"|"AA","target":"player"|"enemy","hit":true|false}],
  "elapsed": "instant"|"short"|"medium"|"long"|"very_long",
  "distance": <number>,
  "blocked": true|false,
  "cs": {"player": <added>, "enemy": <added>},
  "minions": {"player":{"melee":<n>,"ranged":<n>},"enemy":{"melee":<n>,"ranged":<n>}},
  "enemySkillUp": null|"Q"|"W"|"E",
  "suggestions": [{"requires":"Q"|"W"|"E"|"R"|null,"ifLevelUp":"Q"|"W"|"E"|null,"text":"Korean with reasoning"}]
}

## SUGGESTION RULES
- Generate 5-7 suggestions per turn, priority order (best first)
- Text MUST include reasoning: "상대 Q 쿨타임이니까 Q1으로 견제" (not just "Q1으로 견제")
- No emoji in suggestion text
- "requires": skill key needed to execute (null if no skill needed, e.g. CS or positioning)
- "ifLevelUp": null for general suggestions (shown on normal turns)

### LEVEL-UP SUGGESTIONS (CRITICAL)
When THIS TURN causes a player level-up (player gains enough CS to level up):
- You MUST generate ifLevelUp suggestions for EACH learnable skill (Q, W, E)
- For each skill X the player could learn: generate 1-2 suggestions with "ifLevelUp": "X"
  - These suggestions should assume the player WILL learn X and use it immediately
  - Example: {"requires":"W","ifLevelUp":"W","text":"새로 배운 W1 쉴드 걸고 안전하게 교전 시도"}
  - The "requires" should match the ifLevelUp skill (since player will just learn it)
- Also include 1-2 general suggestions with "ifLevelUp": null
- Total: ~2 per learnable skill + 1-2 general = 7-8 suggestions
- The client filters: after player picks skill X, only ifLevelUp=X and ifLevelUp=null are shown

## aiChat RULES (CRITICAL)
aiChat is the OPPONENT speaking directly to the player — like in-game all-chat.
- The opponent is the ENEMY champion. They speak as a rival/competitor.
- They react to what just happened FROM THEIR PERSPECTIVE:
  - If they landed a good hit: 도발/자신감 ("ㅋㅋ 그거 아팠을걸?", "너무 쉬운데?")
  - If they got hit: 인정하되 반격 예고 ("아 그건 좀 아팠음", "운 좋았다 다음엔 안 맞음")
  - If they dodged: 놀림 ("Q 어디 쏘는거야 ㅋㅋ", "느려~")
  - If they outplayed: 설명 ("쉴드 먼저 걸어야지", "거기서 들어오면 안 됐는데")
- Tone: casual Korean (~했음/~됐음/~인듯/~ㅋㅋ), competitive but not toxic
- Include counter-play reasoning or tips naturally ("Q2는 잃은 체력 비례라 지금 들어오면 더 아팠을듯")
- NEVER speak as a narrator or game master. ALWAYS speak as the enemy player.
- 1-2 sentences max`;
}

function buildDynamicPrompt(state, champ) {
  const p = state.player, e = state.enemy;

  return `## CURRENT STATE
Distance: ${state.distance} | Blocked: ${state.blocked}

### Player
HP: ${p.hp}/${p.maxHp} | ${champ.resource}: ${p.resource}/${p.maxResource}
Lv${p.level} | CS: ${p.cs} | AD: ${p.ad} | Armor: ${p.armor} | MR: ${p.mr}
Skills: ${fmtSkills(p)} | Shields: ${fmtShields(p)}
Spells: ${fmtSpells(p)} | Rune: ${p.rune}

### Enemy
HP: ${e.hp}/${e.maxHp} | ${champ.resource}: ${e.resource}/${e.maxResource}
Lv${e.level} | CS: ${e.cs} | AD: ${e.ad} | Armor: ${e.armor} | MR: ${e.mr}
Skills: ${fmtSkills(e)} | Shields: ${fmtShields(e)}
Spells: ${fmtSpells(e)} | Rune: ${e.rune}
${e.skillPoints > 0 ? 'SkillPoints: ' + e.skillPoints + ' (MUST choose enemySkillUp)' : ''}

### Minions
Player: ${state.minions.player.melee}M ${state.minions.player.ranged}R | Enemy: ${state.minions.enemy.melee}M ${state.minions.enemy.ranged}R`;
}

function formatSkills(champ) {
  return Object.values(champ.skills).flatMap(s => s.description.map(d => '- ' + d)).join('\n');
}

function formatRanges(champ) {
  const lines = [];
  for (const [k, s] of Object.entries(champ.skills)) {
    if (s.recast) lines.push(`- ${k}1: ${s.range[0]} | ${k}2: ${s.range[1] === 0 ? 'dash' : s.range[1]}`);
    else lines.push(`- ${k}: ${s.range[0]}`);
  }
  lines.push('- AA: ' + champ.baseStats.attackRange);
  return lines.join('\n');
}

function fmtSkills(f) {
  return ['Q','W','E','R'].map(k => {
    const lv = f.skillLevels[k], cd = f.cooldowns[k];
    if (!lv) return k + ':—';
    return cd > 0 ? `${k}:Lv${lv}(${Math.round(cd)}s)` : `${k}:Lv${lv}✓`;
  }).join(' ');
}

function fmtShields(f) {
  if (!f.shields?.length) return 'none';
  return f.shields.map(s => `${s.source}:${Math.round(s.amount)}`).join(',');
}

function fmtSpells(f) {
  return f.spells.map((s, i) => f.spellCooldowns[i] > 0 ? `${s}(${Math.round(f.spellCooldowns[i])}s)` : s).join(' ');
}
