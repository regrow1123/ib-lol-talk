# ib-lol talk — Technical Design Document

## 1. Overview

Implementation guide for the hybrid LLM text strategy game. Covers all server modules, client architecture, data flow, and edge cases.

Refer to [PRD.md](./PRD.md) for product requirements and game design.

---

## 2. System Flow

### 2.1 Turn Processing Pipeline

```
Client                          Server
  │                               │
  ├─ POST /api/turn ─────────────►│
  │  {gameState, input, history}  │
  │                               ├─ 1. buildPromptParts(gameState)
  │                               │     → staticPrompt (cached) + dynamicPrompt
  │                               ├─ 2. callLLM(gameState, input, history)
  │                               │     → {actions, elapsed, distance, blocked, cs,
  │                               │        minions, narrative, aiChat, suggestions,
  │                               │        enemySkillUp}
  │                               ├─ 3. applyActions(state, llmResult)
  │                               │     ├─ For each action:
  │                               │     │   ├─ validateAction (learned? cooldown?)
  │                               │     │   ├─ calculateSkillEffect (damage/shield)
  │                               │     │   ├─ applyDamage (shield absorb → HP)
  │                               │     │   ├─ consumeResource (energy cost)
  │                               │     │   └─ applyCooldown (set CD on first cast)
  │                               │     ├─ elapsed → seconds conversion
  │                               │     ├─ decrementCooldowns (skills + spells)
  │                               │     ├─ recoverResource (energy 50/sec × elapsed)
  │                               │     ├─ recoverHp (hpRegen × elapsed)
  │                               │     ├─ Update distance, blocked, CS, minions
  │                               │     └─ decayShields (remaining -= elapsed)
  │                               ├─ 4. validateState(state) — guardrails
  │                               ├─ 5. Level-up check (CS → level table)
  │                               │     ├─ Player: set phase='skillup', add skillPoints
  │                               │     └─ Enemy: apply enemySkillUp from LLM
  │                               ├─ 6. Game over check (HP 0 / CS 50)
  │                               │
  │◄─ {state, narrative, aiChat, ─┤
  │    suggestions, levelUp,      │
  │    gameOver}                  │
  │                               │
  ├─ Render UI                    │
  └─ Store state locally          │
```

### 2.2 Skillup Flow (no LLM)

```
Client                          Server
  │                               │
  ├─ POST /api/skillup ──────────►│
  │  {gameState, skill}           │
  │                               ├─ Validate: skillPoints > 0, rank < max,
  │                               │            R only at 6/11/16
  │                               ├─ skillLevels[skill]++, skillPoints--
  │                               ├─ if skillPoints == 0: phase = 'play'
  │◄─ {ok, state} ───────────────┤
  │                               │
  ├─ Re-filter stored suggestions │
  └─ Enable input (if play phase) │
```

---

## 3. Module Specifications

### 3.1 `server/damage.js` — Damage Engine

**Entry point**: `applyActions(state, llmResult) → mutated state`

#### Processing Order (critical — order matters)

**Time passes first, actions execute at end of turn** (ensures resource/cooldown changes from actions are visible in the resulting state).

1. **Elapsed time processing**:
   - Convert `llmResult.elapsed` to seconds via `ELAPSED_MAP`
   - Fallback to `medium` (6s) if invalid/missing
2. **Cooldown decrement** — all skill CDs and spell CDs reduced by elapsed seconds
3. **Resource recovery** — energy: 50/sec × elapsed (capped at max)
4. **HP regen** — (baseRegen + regenPerLevel × (level-1)) × elapsed (capped at maxHp)
5. **Action loop** (sequential, order from LLM preserved):
   - `validateAction()` — skip if skill not learned or invalid key
   - On miss: consume resource + set cooldown, skip damage
   - On hit: calculate damage/shield → apply damage → push shield → consume resource → set cooldown
6. **State updates** — distance, blocked, CS, minions from LLM
7. **Shield decay** — each shield's `remaining` reduced by elapsed, expired shields removed

#### Elapsed Time Mapping
| Key | Seconds | Use Case |
|-----|---------|----------|
| `instant` | 1 | Single skill exchange |
| `short` | 3 | Short combo/trade |
| `medium` | 6 | CS + minor actions |
| `long` | 10 | Farming phase |
| `very_long` | 15 | Long standoff |

#### Damage Calculation
```
rawDamage = baseDamage[phase][rank-1] + (statValue × scalingRatio)

// Q2 special: missing HP bonus
if Q2: rawDamage × (1 + missingHpRatio)   // 1x at full HP, 2x at 0 HP

// Resistance application
physical: rawDamage × 100/(100 + armor)
magic:    rawDamage × 100/(100 + mr)
true:     rawDamage (no reduction)
```

#### Shield System
- `shields: [{amount, remaining, source}]` — array, multiple can coexist
- On damage: oldest shield consumed first (FIFO)
- Shield duration from champion data (`shieldDuration` field, default 2s)
- Decayed by elapsed each turn

#### Cooldown Rules
- Cooldown set on **first cast** (Q1 sets Q cooldown)
- Q2 after Q1: cooldown already running, not reset
- Cooldown value from `skillData.cooldown[rank-1]`
- Decremented by elapsed seconds each turn

#### Resource Consumption
- Cost from `skillData.cost[phase]` (phase 0 = first cast, phase 1 = recast)
- Consumed on both hit AND miss
- AA has no resource cost

### 3.2 `server/validate.js` — Guardrails

**Entry point**: `validateState(state) → clamped state`

Clamps:
- `hp`: 0 to maxHp (rounded)
- `resource`: 0 to maxResource (rounded)
- `cooldowns[key]`: ≥ 0
- `spellCooldowns[i]`: ≥ 0
- `distance`: ≥ 0

### 3.3 `server/prompt.js` — Prompt Generation

**Entry point**: `buildPromptParts(gameState) → {staticPrompt, dynamicPrompt}`

#### Static Prompt (cached via `cache_control`)
Content (doesn't change between turns):
- Game rules and AI behavior principles
- Champion skill descriptions (from JSON)
- Skill range table
- Recast rules
- Combo tips
- Distance & blocked explanation
- Output JSON format specification (with `elapsed`, `minions`, `requires`/`ifLevelUp` tags)
- Suggestion generation rules (reasoning in text, `ifLevelUp` for level-up turns)
- AI speech style rules

Language: English instructions + Korean output examples

#### Dynamic Prompt (changes every turn)
Content:
- Current distance, blocked status
- Both fighters: HP, resource, level, CS, AD, armor, MR
- Shield status (array summary)
- Skill levels + availability (learned/cooldown/resource check)
- Spell status (name + cooldown)
- Rune
- Minion counts

### 3.4 `server/llm.js` — LLM Integration

**Entry point**: `callLLM(gameState, input, history) → parsed LLM response`

#### Retry Logic
- Max 2 retries (3 total attempts)
- Auth/billing errors (401/402/403): no retry
- On `stop_reason === 'max_tokens'`: no retry, return fallback
- Parse failure: retry

#### JSON Extraction (3-stage)
1. Direct `JSON.parse(text)`
2. Extract from markdown code block `` ```json ... ``` ``
3. Manual brace matching (find first `{`, match closing `}`)

#### History Compression
- Last 4 messages (2 turns) sent verbatim as user/assistant pairs
- Older messages summarized as 1-line: `action1 → action2 → ...`

#### Fallback Response
When all retries fail, return a safe neutral response:
- No actions, no CS change
- Keep current distance/blocked/minions
- `elapsed: "medium"`
- Generic safe suggestions with `requires`/`ifLevelUp` tags

### 3.5 `server/game.js` — State Initialization

**Entry point**: `createGameState(championId, spells, rune) → initial state`

#### Initial State
- `phase: 'skillup'` (first skill selection)
- `distance: 800`, `blocked: true`
- Both fighters: full HP, full resource, all skills level 0, 1 skillPoint
- `shields: []`
- Minions: 3 melee + 3 ranged each side
- Enemy: random rune (from 3) + random 2 spells (from 5)

#### Level Table: `csToLevel(cs) → level`
| CS Range | Level |
|----------|-------|
| 0-3 | 1 |
| 4-9 | 2 |
| 10-17 | 3 |
| 18-26 | 4 |
| 27-36 | 5 |
| 37-47 | 6 |
| 48+ | 7 |

#### Stat Recalculation: `recalcStats(fighter, championId)`
On level-up:
```
maxHp = baseHp + hpPerLevel × (level - 1)
ad = baseAd + adPerLevel × (level - 1)
baseAd = initial ad at Lv1 (fixed). ad grows with levels. bonusAD = ad - baseAd (level growth only, no items).
Note: Since there are no items, `bonusAD` scaling in champion JSON is replaced with `totalAD` for meaningful damage.
armor = baseArmor + armorPerLevel × (level - 1)
mr = baseMr + mrPerLevel × (level - 1)
```
HP preserved proportionally: `hp = round(hpRatio × newMaxHp)`

### 3.6 `server/champions.js` — Champion Data Loader

Simple JSON loader with in-memory cache.
- `loadChampion(id)` → parsed JSON from `data/champions/{id}.json`
- Cached after first load (serverless cold start optimization)

---

## 4. API Endpoints

### 4.1 POST /api/turn

#### Request
```json
{
  "gameState": { ... },
  "input": "Q1으로 견제",
  "history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

`history`: array of past turns as user/assistant message pairs. Last 2 turns (4 messages) sent as full objects, older turns as 1-line summary strings. Used for LLM context.

#### Response
```json
{
  "state": { ... },
  "narrative": "...",
  "aiChat": "...",
  "suggestions": [...],
  "levelUp": null | {"newLevel": 2, "who": "player"},
  "gameOver": null | {"winner": "player", "reason": "kill", "summary": "..."},
  "tips": null | ["tip1", "tip2", "tip3"]  // Generated by separate LLM call on game over
}
```

#### Server Processing
1. LLM call → get actions, elapsed, etc.
2. Deep copy state
3. `applyActions(state, llmResult)` — damage, cooldowns, resources, HP regen, shields
4. `validateState(state)` — guardrails
5. Level-up check for both players (CS → level table)
   - Player: add skillPoints, set phase='skillup'
   - Enemy: apply `enemySkillUp` from LLM (with fallback auto-skillup)
6. Game over check — **server determines** (HP 0 or CS 50), ignore LLM
7. Return updated state + LLM narrative/suggestions

#### Error Responses
- `400`: Missing gameState or input
- `405`: Not POST
- `500`: Server/LLM error

### 4.2 POST /api/skillup

#### Request
```json
{
  "gameState": { ... },
  "skill": "Q"
}
```

#### Response
```json
{
  "ok": true,
  "state": { ... }
}
```

#### Validation Rules
- `skillPoints > 0`
- `skillLevels[skill] < maxRank` (5 for Q/W/E, 3 for R)
- R only at level 6/11/16

---

## 5. Client Architecture

### 5.1 Game State Initialization
Client-side (no server call):
1. Fetch `data/champions/{id}.json`
2. Build initial state using champion base stats, selected spells, rune
3. Set `phase: 'skillup'`
4. Show skill selection UI

### 5.2 State Management
- Full game state stored in memory (JS variable)
- Sent to server on each turn
- Updated with server response
- History array maintained locally

### 5.3 Suggestion Filtering Logic

```javascript
function filterSuggestions(suggestions, player, levelUpSkill = null) {
  return suggestions
    .filter(s => {
      // Level-up filtering
      if (levelUpSkill) {
        if (s.ifLevelUp !== null && s.ifLevelUp !== levelUpSkill) return false;
      } else {
        if (s.ifLevelUp !== null) return false;
      }
      // Requires filtering
      if (s.requires) {
        const key = s.requires;
        if (player.skillLevels[key] <= 0) return false;
        if (player.cooldowns[key] > 0) return false;
      }
      return true;
    })
    .slice(0, 3);
}
```

### 5.4 Initial Suggestions (Game Start)
- After first skillup, load from `championData.initialSuggestions[chosenSkill]`
- No LLM call needed
- Same tag format (`requires`/`ifLevelUp`) as LLM suggestions

### 5.5 History Management
```javascript
// After each turn response:
history.push({ role: 'user', content: playerInput });
history.push({ role: 'assistant', content: JSON.stringify({
  narrative, aiChat, actions
}) });
// Client sends full history array to server
// Server handles compression (last 4 verbatim, older summarized)
```

### 5.6 UI State Machine

```
SETUP → SKILLUP → PLAY ⟷ SKILLUP → GAMEOVER
                    ↑                    │
                    └────────────────────┘ (new game)
```

| Phase | Input | Suggestions Area | Status Bar |
|-------|-------|-----------------|------------|
| `setup` | Disabled | Spell/Rune selection | Hidden |
| `skillup` | Disabled | Q/W/E skill buttons | Visible |
| `play` | Enabled | Filtered suggestions (max 3) | Visible |
| `gameover` | Disabled | Hidden | Visible |

---

## 6. Champion Data Schema

### `data/champions/{id}.json`

```jsonc
{
  "id": "lee-sin",
  "name": "리신",
  "nameEn": "Lee Sin",
  "resource": "energy",            // energy | mana | none
  "resourceMax": 200,

  "baseStats": {
    "hp": 645,
    "hpPerLevel": 108,
    "hpRegen": 0.7,                // per second
    "hpRegenPerLevel": 0.13,
    "ad": 69,
    "adPerLevel": 3.7,
    "armor": 36,
    "armorPerLevel": 4.9,
    "mr": 32,
    "mrPerLevel": 2.05,
    "attackRange": 125,
    "moveSpeed": 345
  },

  "passive": {
    "name": "연타",
    "description": "...",
    "energyRestore": [20, 30, 40],
    "energyRestoreLevels": [1, 7, 13]
  },

  "skills": {
    "Q": {
      "name": ["음파", "공명타"],
      "recast": true,
      "range": [1200, 0],            // [phase1, phase2]
      "baseDamage": [
        [55, 80, 105, 130, 155],     // Q1 per rank
        [55, 80, 105, 130, 155]      // Q2 per rank
      ],
      "scaling": [
        {"stat": "totalAD", "ratio": 1.0},
        {"stat": "totalAD", "ratio": 1.0}
      ],
      "damageType": ["physical", "physical"],
      "cost": [50, 25],              // [phase1, phase2]
      "cooldown": [11, 10, 9, 8, 7], // seconds per rank
      "description": ["Q1: ...", "Q2: ..."]
    },
    "W": {
      "recast": true,
      "shield": [55, 110, 165, 220, 275],
      "shieldDuration": 2,
      // ... similar structure
    }
    // E, R...
  },

  "initialSuggestions": {
    "Q": [
      {"requires": "Q", "ifLevelUp": null, "text": "미니언 사이 빈틈으로 Q1 음파 견제"},
      {"requires": "Q", "ifLevelUp": null, "text": "상대가 CS 먹으러 올 때 Q1으로 노리기"},
      {"requires": null, "ifLevelUp": null, "text": "미니언 뒤에서 안전하게 CS 챙기기"}
    ],
    "W": [...],
    "E": [...]
  },

  "tips": {
    "combos": ["Q1 → AA → AA(패시브) → Q2", ...],
    "strengths": ["초반 교전 강함", ...],
    "weaknesses": ["후반 약화", ...]
  }
}
```

---

## 7. Prompt Design

### 7.1 Structure

```
System message:
  [1] Static prompt (cache_control: ephemeral)
      - Game rules
      - Champion data (skills, ranges, combos)
      - Output format specification
      - AI behavior rules
      - Suggestion generation rules (requires/ifLevelUp tags)
  [2] Dynamic prompt
      - Current game state (HP, resource, CDs, distance, etc.)
      - Shield status (array summary)
      - Minion counts

User messages:
  [older turns summarized]
  [recent 2 turns verbatim]
  [current player input]
```

### 7.2 Key Prompt Instructions
- Output must be valid JSON (no markdown wrapping)
- `elapsed`: choose from instant/short/medium/long/very_long based on action intensity
- `actions`: include ALL actions by both sides, in chronological order
- `suggestions`: 5-7 with `requires` and `ifLevelUp` tags, include reasoning in text
- If level-up this turn: generate `ifLevelUp` suggestions for each learnable skill
- `enemySkillUp`: if enemy has skillPoints, MUST choose a skill key
- Skill notation: always Q1/Q2, never bare Q
- Korean output: narrative, aiChat, suggestions text

### 7.3 Prompt Language
- Instructions: English (better LLM comprehension, token efficiency)
- Output examples: Korean (to set tone)
- Champion data: Korean names/descriptions OK

---

## 8. Error Handling

### 8.1 LLM Failures
| Failure | Handling |
|---------|---------|
| API timeout | Retry up to 2x, then fallback |
| Auth error (401/402/403) | No retry, fallback immediately |
| JSON parse failure | Retry up to 2x, then fallback |
| max_tokens truncation | No retry, fallback |
| Invalid elapsed value | Default to `medium` (6s) |
| Missing fields | Use defaults (distance=current, cs={0,0}, etc.) |

### 8.2 Client-Side
| Issue | Handling |
|-------|---------|
| Network error | Show error toast, allow retry |
| Invalid state | Reset to setup screen |
| Empty suggestions after filtering | Show generic "CS 챙기기" fallback |

---

## 9. Implementation Checklist

### 9.1 Server
- [ ] `server/champions.js` — Champion JSON loader with cache
- [ ] `server/game.js` — createGameState(), recalcStats(), csToLevel()
- [ ] `server/damage.js` — Full damage engine (actions → elapsed → recovery → shields)
- [ ] `server/validate.js` — Guardrail clamping
- [ ] `server/prompt.js` — Static/dynamic prompt builder (English instructions)
- [ ] `server/llm.js` — Anthropic API call, JSON extraction, retry, fallback

### 9.2 API
- [ ] `api/turn.js` — LLM → damage engine → level-up → game over → response
- [ ] `api/skillup.js` — Skill validation + state update

### 9.3 Client
- [ ] `src/js/main.js` — State init, API calls, suggestion filtering, history
- [ ] `src/css/style.css` — KakaoTalk chat UI
- [ ] `src/index.html` — Layout (setup, chat, status bar)

### 9.4 Data
- [ ] `data/champions/lee-sin.json` — Full champion data with initialSuggestions

### 9.5 Effects (can be deferred)
- [ ] Summoner spell effects (Flash distance, Ignite DoT, Exhaust reduction, Barrier shield, TP)
- [ ] Rune effects (Conqueror stacks/AD/heal, Electrocute burst, Grasp heal/permanent HP)
- [ ] Passive effects (Lee Sin Flurry energy restore on AA after skill)

### 9.6 Testing
- [ ] Damage calculation unit tests
- [ ] Shield absorption + decay tests
- [ ] Elapsed time processing tests
- [ ] Suggestion filtering tests
- [ ] E2E: full game flow (setup → skillup → turns → game over)
