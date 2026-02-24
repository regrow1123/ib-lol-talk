# ib-lol talk — Technical Design Document

## 1. Overview

Implementation guide for the hybrid LLM text strategy game. Covers all server modules, client architecture, data flow, and edge cases.

Refer to [PRD.md](./PRD.md) for product requirements and game design.

---

## 2. System Flow

### 2.1 State Machine

```
setup → skillup → plan → play → resolve → (plan | skillup | gameover)
```

Each turn involves **two LLM calls**: plan (action generation) and resolve (outcome judgment).

### 2.2 Plan Phase Pipeline

```
Client                          Server (POST /api/plan)
  │                               │
  ├─ POST /api/plan ─────────────►│
  │  {gameState, history}         │
  │                               ├─ buildPlanPrompt(gameState)
  │                               │     → staticPrompt (cached) + dynamicPrompt
  │                               ├─ LLM call (plan)
  │                               │     → {playerActions[3], enemyAction}
  │                               │
  │◄─ {playerActions,  ──────────┤
  │    enemyAction,               │
  │    enemySkillUp}              │
  │                               │
  ├─ Cache enemyAction            │
  ├─ Display playerActions        │
  └─ Enable input (play phase)    │
```

### 2.3 Resolve Phase Pipeline

```
Client                          Server (POST /api/turn)
  │                               │
  ├─ POST /api/turn ─────────────►│
  │  {gameState,                  │
  │   playerAction|input,         │
  │   enemyAction, history}       │
  │                               ├─ 1. buildResolvePrompt(state, playerAction, enemyAction)
  │                               │     → staticPrompt (cached) + dynamicPrompt + action context
  │                               ├─ 2. callResolve(...)
  │                               │     → {actions, elapsed, distance, blocked, cs,
  │                               │        minions, narrative, aiChat, enemySkillUp}
  │                               ├─ 3. applyActions(state, llmResult)
  │                               │     ├─ Elapsed time processing
  │                               │     ├─ Cooldown decrement
  │                               │     ├─ Resource recovery
  │                               │     ├─ HP regen
  │                               │     ├─ Action loop (damage/shield)
  │                               │     ├─ State updates (distance, blocked, CS, minions)
  │                               │     └─ Shield decay
  │                               ├─ 4. validateState(state) — guardrails
  │                               ├─ 5. Level-up check
  │                               ├─ 6. Game over check
  │                               │
  │◄─ {state, narrative, aiChat, ─┤
  │    levelUp, gameOver, tips}   │
  │                               │
  ├─ Render UI                    │
  ├─ If levelUp → skillup UI     │
  ├─ If gameOver → overlay        │
  └─ Else → POST /api/plan       │
```

### 2.4 Skillup Flow (no LLM)

```
Client                          Server
  │                               │
  ├─ POST /api/skillup ──────────►│
  │  {gameState, skill}           │
  │                               ├─ Validate: skillPoints > 0, rank < max,
  │                               │            R only at 6/11/16
  │                               ├─ skillLevels[skill]++, skillPoints--
  │                               ├─ if skillPoints == 0: phase = 'plan'
  │◄─ {ok, state} ───────────────┤
  │                               │
  ├─ If phase='plan' → POST /api/plan
  └─ Else → show skillup UI again │
```

---

## 3. Module Specifications

### 3.1 `server/damage.js` — Damage Engine

**Entry point**: `applyActions(state, llmResult) → mutated state`

Unchanged from previous design. Processing order:
1. Elapsed time → seconds conversion
2. Cooldown decrement
3. Resource recovery
4. HP regen
5. Action loop (validate, damage/shield, resource, cooldown)
6. State updates (distance, blocked, CS, minions)
7. Shield decay

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
if Q2: rawDamage × (1 + missingHpRatio)
physical: rawDamage × 100/(100 + armor)
magic:    rawDamage × 100/(100 + mr)
true:     rawDamage (no reduction)
```

### 3.2 `server/validate.js` — Guardrails

Unchanged. Clamps HP, resource, cooldowns, distance.

### 3.3 `server/prompt.js` — Prompt Generation

Provides two prompt builders:

#### `buildPlanPrompt(gameState)` → `{staticPrompt, dynamicPrompt}`
- Static: shared rules (champion skills, ranges, combos, game rules) + plan-specific instructions
- Dynamic: current state block
- Output format: `{playerActions[3], enemyAction, enemySkillUp}`
- Player actions: 3 choices, priority order, each with `action`, `skills`, `target`, `requires`, `text`
- Enemy action: 1 best action for current state

#### `buildResolvePrompt(gameState, playerAction, enemyAction, isFreeText)` → `{staticPrompt, dynamicPrompt}`
- Static: shared rules + resolve-specific instructions (judgment role, aiChat rules)
- Dynamic: current state block + action context (player + enemy actions)
- Free text mode: includes "interpret player intent" instruction
- Output format: `{narrative, aiChat, actions, elapsed, distance, blocked, cs, minions, enemySkillUp}`

#### Shared rules (`buildSharedRules`)
Extracted into a common function used by both plan and resolve:
- Champion skills, ranges, recast rules, combos
- Minion aggro, wave management, engagement types
- Distance & obstacles, elapsed time rules, CS rules
- Skill usage restrictions

### 3.4 `server/llm.js` — LLM Integration

**Entry point**: `callResolve(gameState, playerAction, enemyAction, isFreeText, history)` → parsed resolve response

- Retry logic: max 2 retries, auth errors skip
- 3-stage JSON extraction (direct parse, code block, brace matching)
- History compression (last 4 verbatim, older summarized)
- Fallback: neutral response (no actions, medium elapsed)

### 3.5 `server/game.js` — State Initialization

Unchanged. `createGameState()`, `recalcStats()`, `csToLevel()`.

### 3.6 `server/champions.js` — Champion Data Loader

Unchanged. Simple JSON loader with cache.

---

## 4. API Endpoints

### 4.1 POST /api/plan

#### Request
```json
{
  "gameState": { ... },
  "history": [...]
}
```

#### Response
```json
{
  "playerActions": [
    {"action": "Q1 poke", "skills": ["Q1"], "target": "enemy", "requires": "Q", "text": "상대 Q 쿨 돌았으니 Q1 꽂아볼까"},
    {"action": "CS farm", "skills": [], "target": null, "requires": null, "text": "미니언 뒤에서 안전하게 CS 챙기자"},
    {"action": "W1 shield", "skills": ["W1"], "target": "self", "requires": "W", "text": "W1 쉴드 걸고 접근해볼까"}
  ],
  "enemyAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "player", "text": "음파 한 발 꽂아줄까"},
  "enemySkillUp": null
}
```

#### Error Responses
- `400`: Missing gameState
- `405`: Not POST
- `500`: Server/LLM error

### 4.2 POST /api/turn (Resolve)

#### Request (choice click)
```json
{
  "gameState": { ... },
  "playerAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "enemy", "text": "..."},
  "enemyAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "player", "text": "..."},
  "history": [...]
}
```

#### Request (free text)
```json
{
  "gameState": { ... },
  "input": "Q1으로 견제해볼까",
  "enemyAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "player", "text": "..."},
  "history": [...]
}
```

#### Response
```json
{
  "state": { ... },
  "narrative": "...",
  "aiChat": "...",
  "levelUp": null | {"newLevel": 2, "who": "player"},
  "gameOver": null | {"winner": "player", "reason": "kill", "summary": "..."},
  "tips": null | ["tip1", "tip2", "tip3"]
}
```

**Note**: No `suggestions` field — plan phase handles action generation.

#### Error Responses
- `400`: Missing gameState, enemyAction, or playerAction/input
- `405`: Not POST
- `500`: Server/LLM error

### 4.3 POST /api/skillup

Unchanged.

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

When `skillPoints` reaches 0, `state.phase` is set to `"plan"` (was `"play"` before).

---

## 5. Client Architecture

### 5.1 State Management
- `gameState`: full game state
- `pendingEnemyAction`: cached enemy action from plan phase (cleared after resolve)
- `currentPlayerActions`: 3 player choices from plan phase
- `history`: conversation history for LLM context

### 5.2 UI State Machine

```
SETUP → SKILLUP → PLAN → PLAY ──→ RESOLVE → PLAN (loop)
                    ↑       │                    │
                    └───────┘ (levelup)          │
                                                 └→ GAMEOVER
```

| Phase | Input | Suggestions Area | Action |
|-------|-------|-----------------|--------|
| `setup` | Disabled | Spell/Rune selection | — |
| `skillup` | Disabled | Q/W/E skill buttons | POST /api/skillup |
| `plan` | Disabled | "행동 계획 중..." loading | POST /api/plan |
| `play` | Enabled | 3 player choices | Click choice or type |
| `resolve` | Disabled | Loading indicator | POST /api/turn |
| `gameover` | Disabled | Hidden | — |

### 5.3 Turn Flow (Client Perspective)
1. **Resolve completes** → render narrative/aiChat → check gameOver/levelUp
2. If normal: **call plan** → cache enemyAction → display 3 choices → enable input
3. Player clicks choice → `sendAction(playerAction)` → POST /api/turn with `{playerAction, enemyAction}`
4. Player types free text → `sendInput()` → POST /api/turn with `{input, enemyAction}`
5. → back to step 1

### 5.4 Skillup → Plan Transition
1. Skillup response has `phase: 'plan'` when skillPoints = 0
2. Client calls `callPlan()` immediately
3. Plan response → display choices → play phase

### 5.5 History Management
```javascript
// After each resolve:
history.push({ role: 'user', content: playerText });
history.push({ role: 'assistant', content: JSON.stringify({ narrative, aiChat, actions }) });
```

---

## 6. Champion Data Schema

Unchanged from previous design. See `data/champions/{id}.json`.

Note: `initialSuggestions` in champion JSON is no longer used (plan API generates first choices after skillup).

---

## 7. Prompt Design

### 7.1 Shared Rules
Common to both plan and resolve prompts:
- Champion skills, ranges, recast rules, combos
- Game mechanics (minion aggro, wave management, engagement types)
- Distance & obstacles, elapsed time, CS rules
- Skill usage restrictions

### 7.2 Plan Prompt
```
System message:
  [1] Shared rules + plan instructions (cache_control: ephemeral)
      - Role: strategic planner
      - Generate 3 player choices (priority order)
      - Generate 1 enemy best action
      - AI behavior principles
      - Action text rules (1st person casual Korean)
      - Output format
  [2] Current game state (dynamic)

User messages:
  [recent history summary if any]
  "다음 턴 행동을 계획해줘."
```

### 7.3 Resolve Prompt
```
System message:
  [1] Shared rules + resolve instructions (cache_control: ephemeral)
      - Role: judge/referee
      - Server handles numbers
      - aiChat rules
      - Output format (no suggestions)
  [2] Current game state + action context (dynamic)
      - Player action (chosen or free text)
      - Enemy action (locked from plan)

User messages:
  [compressed history]
  "이번 턴 결과를 판정해줘."
```

### 7.4 Key Differences from Previous Design
- **No suggestions in resolve output** — plan handles all action generation
- **Enemy action locked at plan time** — resolve cannot change it
- **Two separate prompts** with different roles (planner vs judge)
- **Shared rules extracted** into common function for consistency

---

## 8. Error Handling

### 8.1 Plan Failures
| Failure | Handling |
|---------|---------|
| API timeout | Retry up to 2x, then fallback (generic CS/poke/wave choices) |
| JSON parse failure | Retry up to 2x, then fallback |
| Missing playerActions/enemyAction | Fallback |

### 8.2 Resolve Failures
| Failure | Handling |
|---------|---------|
| API timeout | Retry up to 2x, then fallback (neutral, no actions) |
| JSON parse failure | Retry up to 2x, then fallback |
| max_tokens truncation | No retry, fallback |

### 8.3 Client-Side
| Issue | Handling |
|-------|---------|
| Network error | Show error toast, re-enable input |
| No pendingEnemyAction | Prevent send (button disabled) |
| Empty plan response | Show generic fallback choices |

---

## 9. Implementation Checklist

### 9.1 Server
- [x] `server/champions.js` — Champion JSON loader with cache
- [x] `server/game.js` — createGameState(), recalcStats(), csToLevel()
- [x] `server/damage.js` — Full damage engine
- [x] `server/validate.js` — Guardrail clamping
- [x] `server/prompt.js` — Plan + Resolve prompt builders (shared rules extracted)
- [x] `server/llm.js` — callResolve() with retry + fallback

### 9.2 API
- [x] `api/plan.js` — Plan phase (LLM: 3 player choices + 1 enemy action)
- [x] `api/turn.js` — Resolve phase (LLM: judgment + damage engine)
- [x] `api/skillup.js` — Skill validation (phase → 'plan' on completion)

### 9.3 Client
- [x] `src/js/main.js` — Plan/resolve flow, pendingEnemyAction, callPlan()

### 9.4 Data
- [x] `data/champions/lee-sin.json` — Champion data (initialSuggestions now unused)
