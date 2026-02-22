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
1. **Action loop** (sequential, order from LLM preserved):
   - `validateAction()` — skip if skill not learned or not a valid key
   - On miss: consume resource + set cooldown, skip damage
   - On hit: calculate damage/shield → apply damage → push shield → consume resource → set cooldown
2. **Elapsed time processing**:
   - Convert `llmResult.elapsed` to seconds via `ELAPSED_MAP`
   - Fallback to `medium` (6s) if invalid/missing
3. **Cooldown decrement** — all skill CDs and spell CDs reduced by elapsed seconds
4. **Resource recovery** — energy: 50/sec × elapsed (capped at max)
5. **HP regen** — (baseRegen + regenPerLevel × (level-1)) × elapsed (capped at maxHp)
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

Does NOT validate:
- CS (can only increase, never decrease — enforced by engine)
- Level (only increases via CS table)
- Skill levels (validated in skillup endpoint)

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
- Output JSON format specification
- Suggestion format rules
- AI speech style rules

#### Dynamic Prompt (changes every turn)
Content:
- Current distance, blocked status
- Both fighters: HP, resource, level, CS, AD, armor, MR, shields
- Skill levels + availability (learned/cooldown/resource check)
- Spell status (name + cooldown)
- Rune
- Minion counts

#### TODO (needs rewrite)
Current prompt.js issues:
- References removed fields (`turn`, `buffs`, `debuffs`, `shield` as number)
- Suggestions format uses old `skill` tag instead of `requires`/`ifLevelUp`
- No `elapsed` instruction in output format
- No `minions` in output format
- Korean instructions → should be English instructions + Korean output examples
- Shield display should show array summary, not single number
- Missing `gameOver` removal from output format
- Missing initial suggestions / `ifLevelUp` generation rules

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
- Last 4 messages (2 turns) sent verbatim
- Older messages summarized as 1-line: `action1 → action2 → ...`

#### Fallback Response
When all retries fail:
```json
{
  "narrative": "양쪽 모두 조심스럽게 거리를 재고 있다.",
  "aiChat": "잠깐 집중이 풀렸음. 다시 집중!",
  "actions": [],
  "distance": <current>,
  "blocked": <current>,
  "cs": {"player": 0, "enemy": 0},
  "suggestions": [generic safe suggestions]
}
```

#### TODO (needs update)
- Fallback response uses old suggestion format (`skill` instead of `requires`/`ifLevelUp`)
- Should include `elapsed: "medium"` in fallback
- Should include `minions` in fallback

### 3.5 `server/game.js` — State Initialization

**Entry point**: `createGameState(championId, spells, rune) → initial state`

#### Initial State
- `phase: 'skillup'` (first skill selection)
- `distance: 800`, `blocked: true`
- Both fighters: full HP, full resource, all skills level 0, 1 skillPoint
- Minions: 3 melee + 3 ranged each side
- Enemy: random rune (from 3) + random 2 spells (from 5)

#### Level Table: `csToLevel(cs) → level`
| CS | Level |
|----|-------|
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
baseAd = ad (no items)
armor = baseArmor + armorPerLevel × (level - 1)
mr = baseMr + mrPerLevel × (level - 1)
```
HP preserved proportionally: `hp = hpRatio × newMaxHp`

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
  "gameState": { ... },    // Full game state from client
  "input": "Q1으로 견제",   // Player's natural language input
  "history": [             // Chat history for LLM context
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

#### Response
```json
{
  "state": { ... },           // Updated game state
  "narrative": "...",          // Combat narration (Korean)
  "aiChat": "...",             // Opponent comment (Korean, casual)
  "suggestions": [...],        // 5-7 tagged suggestions
  "levelUp": null | {          // null or level-up info
    "newLevel": 2,
    "who": "player"
  },
  "gameOver": null | {         // null or game-over info
    "winner": "player",
    "reason": "kill",
    "summary": "..."
  }
}
```

#### Error Responses
- `400`: Missing gameState or input
- `405`: Not POST
- `500`: Server/LLM error

### 4.2 POST /api/skillup

#### Request
```json
{
  "gameState": { ... },
  "skill": "Q"              // Q, W, E, or R
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

### 5.1 State Management
- Full game state stored in memory (JS variable)
- Sent to server on each turn
- Updated with server response
- History array maintained locally

### 5.2 Suggestion Filtering Logic

```javascript
function filterSuggestions(suggestions, player, levelUpSkill = null) {
  return suggestions
    .filter(s => {
      // Level-up filtering
      if (levelUpSkill) {
        // Show: ifLevelUp matches chosen skill OR ifLevelUp is null
        if (s.ifLevelUp !== null && s.ifLevelUp !== levelUpSkill) return false;
      } else {
        // Normal turn: only ifLevelUp null
        if (s.ifLevelUp !== null) return false;
      }
      // Requires filtering
      if (s.requires) {
        const key = s.requires;
        if (player.skillLevels[key] <= 0) return false;  // not learned
        if (player.cooldowns[key] > 0) return false;      // on cooldown
      }
      return true;
    })
    .slice(0, 3);  // max 3
}
```

### 5.3 Initial Suggestions (Game Start)
- After first skillup, load from `championData.initialSuggestions[chosenSkill]`
- No LLM call needed
- Same tag format as LLM suggestions

### 5.4 History Management
```javascript
// After each turn response:
history.push({ role: 'user', content: playerInput });
history.push({ role: 'assistant', content: JSON.stringify({
  narrative: response.narrative,
  aiChat: response.aiChat,
  actions: response.state._lastActions  // or store separately
}) });

// Client sends full history array to server
// Server handles compression (last 4 verbatim, older summarized)
```

### 5.5 UI State Machine

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
  "name": "리신",                    // Korean name
  "nameEn": "Lee Sin",              // English name
  "resource": "energy",              // energy | mana | none
  "resourceMax": 200,

  "baseStats": {
    "hp": 645,
    "hpPerLevel": 108,
    "hpRegen": 0.7,                  // HP regen per second
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
      "name": ["음파", "공명타"],     // [phase1, phase2] for recast
      "recast": true,
      "range": [1200, 0],             // [phase1, phase2] (0 = dash to target)
      "baseDamage": [                  // [phase][rank-1]
        [55, 80, 105, 130, 155],       // Q1
        [55, 80, 105, 130, 155]        // Q2 (before missing HP bonus)
      ],
      "scaling": [
        {"stat": "bonusAD", "ratio": 1.0},   // Q1
        {"stat": "bonusAD", "ratio": 1.0}    // Q2
      ],
      "damageType": ["physical", "physical"],
      "cost": [50, 25],               // [Q1, Q2] energy cost
      "cooldown": [11, 10, 9, 8, 7],  // seconds per rank
      "description": ["Q1: ...", "Q2: ..."]
    },
    "W": {
      "recast": true,
      "shield": [55, 110, 165, 220, 275],  // shield amount per rank
      "shieldDuration": 2,                    // seconds
      // ... similar structure
    }
    // E, R...
  },

  "initialSuggestions": {
    "Q": [ /* suggestions for Q first */ ],
    "W": [ /* suggestions for W first */ ],
    "E": [ /* suggestions for E first */ ]
  },

  "tips": {
    "combos": ["..."],
    "strengths": ["..."],
    "weaknesses": ["..."]
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
      - Minion counts
      - Shield status

User messages:
  [older turns summarized]
  [recent 2 turns verbatim]
  [current player input]
```

### 7.2 Key Prompt Instructions (to implement)
- Output must be valid JSON (no markdown wrapping)
- `elapsed`: choose from instant/short/medium/long/very_long based on action intensity
- `actions`: include ALL actions by both sides, in chronological order
- `suggestions`: 5-7 with `requires` and `ifLevelUp` tags, include reasoning in text
- If level-up this turn: generate `ifLevelUp` suggestions for each learnable skill
- `enemySkillUp`: if enemy has skillPoints, MUST choose a skill key
- Skill notation: always Q1/Q2, never bare Q
- Korean output: narrative, aiChat, suggestions text
- English: JSON keys

### 7.3 Prompt Language
- Instructions in English (better LLM comprehension, token efficiency)
- Output examples in Korean (to set the tone for Korean output)
- Champion data can stay in Korean (names, descriptions)

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

## 9. TODO — Implementation Tasks

### 9.1 Rewrite Required
- [ ] **`server/prompt.js`** — Full rewrite for new architecture
  - English instructions
  - `elapsed` in output format
  - `requires`/`ifLevelUp` suggestion tags
  - Remove `turn`, `buffs`, `debuffs`, `gameOver` references
  - Shield array display
  - `minions` in output format
- [ ] **`server/llm.js`** — Update fallback response format
  - Add `elapsed`, `minions`
  - Update suggestion tags
- [ ] **`api/turn.js`** — Remove old field references
  - Remove `gameState.turn` logging
  - Server-only gameOver (ignore LLM's gameOver)
- [ ] **Frontend** — Full rewrite
  - `src/js/main.js` — State management, API calls, suggestion filtering
  - `src/css/style.css` — KakaoTalk chat UI
  - `src/index.html` — Layout structure

### 9.2 New Implementation
- [ ] Client-side game state initialization (from champion JSON)
- [ ] Initial suggestions loading from champion JSON
- [ ] Summoner spell effects in damage engine
- [ ] Rune effects in damage engine (Conqueror stacks, Electrocute proc, Grasp heal)
- [ ] Passive effects (Lee Sin Flurry energy restore)

### 9.3 Testing
- [ ] Damage calculation unit tests
- [ ] Shield absorption + decay tests
- [ ] Elapsed time processing tests
- [ ] Suggestion filtering tests
- [ ] E2E: full game flow (setup → skillup → turns → game over)
- [ ] LLM response parsing edge cases
