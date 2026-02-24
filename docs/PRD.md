# ib-lol talk — PRD

## 1. Product Overview

An **LLM-based text strategy game** simulating LoL 1v1 laning phase.

**One-liner**: Learn LoL laning by chatting with an LLM.

### Target Users
- People interested in LoL but intimidated by the learning curve
- Players who want to learn champion skills and laning basics through text first
- LoL veterans who enjoy mind games and strategic decision-making

### Core Experience
1. **Natural language input** → AI responds based on the situation → strategic choices determine outcomes
2. **Skill mechanics naturally explained through combat narration** → learn by playing
3. **Opponent explains reasoning for their counter-play** → accumulate practical knowledge

---

## 2. Architecture

### 2.1 Hybrid Structure

```
Client (holds state) → Server (LLM call + damage calc + guardrails) → Client
```

| Role | Responsibility | Details |
|------|---------------|---------|
| **LLM (plan)** | Action generation | Generate player choices (3) + enemy best action (1) based on current state |
| **LLM (resolve)** | Judgment | Hit/miss, elapsed, distance/blocked, narration, aiChat from confirmed actions |
| **Server (Damage Engine)** | Numeric calculation | Damage/shield calc from actions (LoL formulas), rune/spell effects, cooldown/resource management |
| **Server (Guardrails)** | Range validation | HP/resource/cooldown clamping, CS decrease prevention |
| **Client** | State + UI | Holds full state, sends to server each turn, UI rendering, enemy action caching |

### 2.2 State Machine

```
setup → skillup → plan → play → resolve → (plan | skillup | gameover)
```

| Phase | Description |
|-------|-------------|
| `setup` | Spell/rune selection |
| `skillup` | Skill point allocation (no LLM) |
| `plan` | LLM generates player choices (3) + enemy action (1) |
| `play` | Player selects a choice or types free text |
| `resolve` | LLM judges outcome from confirmed player + enemy actions |

**Two LLM calls per turn**: plan (action generation) → resolve (outcome judgment). Enemy action is locked at plan time and cannot change during resolve.

### 2.3 Core Principle

**Plan = what could happen, Resolve = what did happen, Server = how much it hurts**

- Plan LLM: "Player can Q1 poke / farm CS / W1 shield in. Enemy will Q1 poke."
- Resolve LLM: "Q1 hit, followed up with Q2, opponent shielded with W1"
- Server: Q1 damage + Q2 damage - W1 shield = actual HP change
- LLM doesn't know numbers → no specific numbers needed in narration

### 2.4 Non-Fixed Time Model (elapsed)

Time interval between turns is **not fixed**.

- A single turn can contain multiple actions (combos, exchanges)
- LLM returns `elapsed` each turn: the time scale of this turn
  - `"instant"` = 1 sec (single skill exchange)
  - `"short"` = 3 sec (short combo/trade)
  - `"medium"` = 6 sec (a few CS + minor actions)
  - `"long"` = 10 sec (farming phase)
  - `"very_long"` = 15 sec (long standoff, recall wait)
- Server converts `elapsed` to seconds for **cooldown reduction, resource recovery, HP regen**
- Damage engine calculates **instant effects** (skill damage, shield amount, resource consumption)

**Why this approach**: A player's choice could be "poke with Q1" (1 sec) or "farm 3 CS while clearing minions" (10 sec). LLM can't estimate exact seconds reliably, but choosing from 5 tiers is straightforward. Server uses fixed mapping for numeric consistency.

### 2.5 Role Boundaries

| | LLM | Server |
|---|---|---|
| Skill hit/miss | ✅ Judges | ❌ |
| Damage values | ❌ | ✅ LoL formula calc |
| Elapsed time | ✅ instant/short/medium/long/very_long | Converts to seconds → cooldown/resource/HP |
| Cooldowns | ❌ | ✅ Set on skill use + elapsed reduction |
| Resource (energy etc.) | ❌ | ✅ Skill consumption + elapsed natural recovery |
| Distance / blocked | ✅ Returns values | Clamp (≥0) only |
| CS acquisition | ✅ Judges | Accumulate + level-up check |
| Level-up stats | ❌ | ✅ LoL formulas |
| Enemy skill-up | ✅ Chooses | Validity check |
| HP changes | ❌ | ✅ Damage engine result |
| HP regen | ❌ | ✅ elapsed-based natural regen |
| Shield | ❌ | ✅ Calc + damage absorption |
| Narration / comments | ✅ | ❌ |
| Player choices (plan) | ✅ Generates 3 | ❌ (client displays) |
| Enemy action (plan) | ✅ Generates best 1 | ❌ (client caches) |

### 2.6 Stateless Server
- Vercel Serverless Functions
- No state storage — client sends full state each turn

### 2.7 Cost Optimization
- **Prompt caching**: static (champion data + rules) / dynamic (current state) split → `cache_control`
- **LLM doesn't calculate numbers**: outputs only actions + state values → saves output tokens
- **History compression**: last 2 turns verbatim, older turns as 1-line summaries

---

## 3. Game Design

### 3.1 HP System
- **Real values** (Lee Sin Lv1: 645 HP, +108 per level)
- UI shows actual numbers (e.g., 487 / 645)
- Damage calculated by server damage engine using LoL formulas
- LLM only judges hit/miss, no number crunching

### 3.2 Distance & Obstacles

#### distance (number, units)
Distance between two champions. LLM returns each turn.
- Initial: 800
- LLM changes based on actions (dash, retreat, approach, etc.)

#### blocked (boolean)
Whether minions exist on the **direct line** between two champions.
- `true` → projectiles (Q1 etc.) blocked by minions
- `false` → projectiles pass through
- E1 (AoE around self), R/AA (targeted) are unaffected by blocked
- Minions elsewhere (not on direct line) → still `false`

#### Skill Ranges
Each skill's range defined in `data/champions/{id}.json`. Dynamically injected into prompts.
- distance 300 + Q1 (range 1200) → in range
- distance 300 + AA (range 125) → out of range
- LLM compares distance with skill range for hit/miss judgment

### 3.3 Turn System (Plan / Resolve Split)

Each turn consists of two LLM calls:

#### Plan Phase
1. Server receives current game state
2. LLM generates:
   - **3 player action choices** (priority order, best first) — each with `action` description, `skills` used, `target`, and `text` (1st-person casual action declaration)
   - **1 enemy action** (best action for current state) — same format
3. Enemy action is **locked** at this point (stored on client)
4. Player choices displayed as suggestion chips

#### Play Phase
- Player clicks a choice OR types free text
- Free text allows any action (not limited to 3 choices)

#### Resolve Phase
1. Player's chosen/typed action + locked enemy action sent to server
2. LLM judges outcome: hit/miss, elapsed, distance, narrative, aiChat
3. Server applies damage engine, level-up, game over checks
4. **No suggestions generated** — plan phase handles this

#### Auto-scaling Turn Granularity
| Situation | Processing |
|-----------|-----------|
| Both low intensity (farming/waiting) | Summarized (more time passes) |
| Either high intensity (combat) | Detailed (less time passes) |

#### Key Constraint
- Enemy action is determined at plan time, not resolve time
- This prevents the AI from "reacting" to the player's choice after seeing it
- Creates genuine strategic decision-making

### 3.4 Resource System
- Different resource types per champion (energy, mana, resourceless, etc.)
- Resource values defined in `data/champions/{id}.json`
- **Server calculates everything**: consumption from actions + natural recovery from elapsed
- Energy: 50/sec natural recovery (e.g., elapsed="short" (3s) → +150 recovery)
- **Turn order**: time passes first (cooldowns, recovery, regen) → actions execute at end of turn
- This ensures resource consumption is visible (not immediately recovered)

### 3.5 Level-Up
- **Server manages 100%** (not LLM)
- CS-based level table:

| CS | Level | CS Required |
|----|-------|-------------|
| 0 | 1 | - |
| 4 | 2 | 4 |
| 10 | 3 | 6 |
| 18 | 4 | 8 |
| 27 | 5 | 9 |
| 37 | 6 | 10 |
| 48 | 7 | 11 |

- On level-up: `phase: 'skillup'` → input disabled → skill selection → back to play
- **Enemy level-up**: LLM chooses via `enemySkillUp` field (situation-based), server validates only

### 3.6 Minion System
- LLM judges wave arrival timing and minion counts (matching non-fixed time model)
- Wave composition: 3 melee + 3 ranged
- Minions auto-fight each other → natural attrition
- Last-hitting required for CS credit
- Minion presence affects `blocked`
- LLM returns minion counts, server stores in state

### 3.7 Items
- **No item system** — no shop, no item purchases, no starting items
- All stats are pure base stats from champion data
- Simplifies game to focus on skill usage and laning fundamentals

### 3.8 Win Conditions
- **Kill**: opponent HP reaches 0
- **CS 50**: first to reach CS 50
- No simultaneous kills — whoever lands the hit first gets the kill
- **Server determines game over** (not LLM) — `gameOver` in LLM response is ignored; server checks HP/CS after damage engine

---

## 4. Skill System

### 4.1 Notation Rules
- Skill structure **varies per champion** — recast availability, phases, etc. defined in JSON
- Recast skills: can recast phase 2 after using phase 1 (e.g., Lee Sin Q1→Q2, W1→W2, E1→E2)
- Non-recast skills: single use (e.g., Lee Sin R)
- Recast skill notation: **Q1/Q2** (always include number, never bare Q)
- Recast cooldown **starts on phase 1 cast** (regardless of whether phase 2 is used)
- Resource cost can differ per phase (e.g., Q1: 50, Q2: 25)
- **Cooldowns in seconds** — server sets on skill use + reduces by elapsed. 0 = ready, positive = remaining seconds.
- All skill structures defined in `data/champions/{id}.json`

### 4.2 Champion Data
- Independent JSON files at `data/champions/{id}.json`
- Includes: skill ranges, damage formulas (baseDamage arrays, scaling ratios), recast flags, special mechanics
- Dynamically injected into prompts during generation
- Adding a champion = add JSON file + add to `data/champions/index.json`. No code changes needed.
- **Scaling note**: Since there's no item system, `bonusAD` scaling is replaced with `totalAD` (bonusAD = 0 without items)

---

## 5. Opponent (AI)

### 5.1 Behavior Principles
- **Equal opponent** — no mercy, actively counter-attacks
- Player attacks don't always succeed
- AI can initiate, no biased judgment
- **No fixed personality** — dynamically adapts based on current state (HP, cooldowns, distance, CS gap)
- **Diverse situations** — no pattern repetition, actively uses varied skill combinations/strategies

### 5.2 Speech Style (Korean)
- Casual endings: ~했음, ~됐음, ~인듯, ~ㅋㅋ
- Friendly + reasoning for counter-play + tips
- Examples: "잘 피했음", "Q2는 잃은 체력 비례라 지금 들어가면 더 아팠을듯"

### 5.3 Educational Role
- Uses each skill's unique effects situationally → learning through experience
- Varied skill combinations (no pattern repetition)
- Explains counter-play reasoning to transfer practical knowledge

---

## 6. Action Choices (Plan Phase)

### 6.1 Design Principles
- Choices are generated by the **plan LLM call**, not the resolve call
- Each choice must **reveal the reasoning/rationale/intent** behind the action
- Players learn laning judgment just by reading choices
- **Written in player's first-person casual voice** (action declaration)
  - ✅ "상대 Q 쿨 돌았으니 Q1 꽂아볼까"
  - ❌ "Q1으로 견제하세요"
- No emoji

### 6.2 Plan Output Format
```json
{
  "playerActions": [
    {"action": "Q1 poke", "skills": ["Q1"], "target": "enemy", "text": "상대 Q 쿨 돌았으니 Q1 꽂아볼까"},
    {"action": "CS farm", "skills": [], "target": null, "text": "미니언 뒤에서 안전하게 CS 챙기자"},
    {"action": "W1 shield in", "skills": ["W1"], "target": "self", "text": "W1 쉴드 걸고 접근해볼까"}
  ],
  "enemyAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "player", "text": "음파 한 발 꽂아줄까"}
}
```

### 6.3 Generation Rules
- **3 player choices**, priority order (best first)
- **1 enemy action** — best action for current state (not 3 to pick from)
- `text`: 1st-person casual Korean action declaration with reasoning
- `skills`: list of skills involved (for client-side availability display)
- `requires`: primary skill key needed (for filtering), null if none
- Enemy action locked at plan time — cannot change during resolve

### 6.4 Client Display
- All 3 player choices shown as suggestion chips (no additional filtering)
- Player can also type free text instead of clicking a choice
- Free text goes through resolve with intent interpretation

---

## 7. Summoner Spells & Runes

### Summoner Spells (pick 2 from 5)
| Spell | Effect |
|-------|--------|
| Flash | Instant blink, dodge/engage |
| Ignite | DoT + healing reduction |
| Exhaust | Slow + 35% damage reduction |
| Barrier | Instant shield |
| Teleport (TP) | Quick return after recall |

### Runes (pick 1 from 3)
| Rune | Trait |
|------|-------|
| Conqueror | Extended trades. Stacks → AD increase + healing |
| Electrocute | Short trades. 3 hits → burst damage |
| Grasp of the Undying | Sustain. AA → bonus damage + heal + permanent HP |

---

## 8. LLM Response Formats

### 8.1 Plan Response
```json
{
  "playerActions": [
    {"action": "Q1 poke", "skills": ["Q1"], "target": "enemy", "requires": "Q", "text": "상대 Q 쿨 돌았으니 Q1 꽂아볼까"},
    {"action": "CS farm", "skills": [], "target": null, "requires": null, "text": "미니언 뒤에서 안전하게 CS 챙기자"},
    {"action": "W1 shield in", "skills": ["W1"], "target": "self", "requires": "W", "text": "W1 쉴드 걸고 접근해볼까"}
  ],
  "enemyAction": {"action": "Q1 poke", "skills": ["Q1"], "target": "player", "text": "음파 한 발 꽂아줄까"}
}
```

### 8.2 Resolve Response
```json
{
  "narrative": "Combat narration 1-2 sentences (Korean)",
  "aiChat": "Opponent comment in Korean casual style",
  "actions": [
    {"who": "player", "skill": "Q1", "target": "enemy", "hit": true},
    {"who": "enemy", "skill": "E1", "target": "player", "hit": true}
  ],
  "elapsed": "short",
  "distance": 100,
  "blocked": false,
  "cs": {"player": 2, "enemy": 1},
  "minions": {"player": {"melee": 2, "ranged": 3}, "enemy": {"melee": 1, "ranged": 2}},
  "enemySkillUp": null
}
```

### Narration Rules
- **1-2 sentences** max. Keep concise.
- Skill effect explanations woven naturally into context

---

## 9. Game State Schema

```json
{
  "phase": "play",
  "distance": 800,
  "blocked": true,
  "player": {
    "champion": "lee-sin",
    "hp": 645,
    "maxHp": 645,
    "resource": 200,
    "maxResource": 200,
    "resourceType": "energy",
    "level": 1,
    "cs": 0,
    "ad": 69,
    "baseAd": 69,
    "armor": 36,
    "mr": 32,
    "skillLevels": {"Q": 0, "W": 0, "E": 0, "R": 0},
    "skillPoints": 1,
    "cooldowns": {"Q": 0, "W": 0, "E": 0, "R": 0},
    "shields": [],
    "spells": ["flash", "ignite"],
    "spellCooldowns": [0, 0],
    "rune": "conqueror"
  },
  "enemy": { "...same structure..." },
  "minions": {
    "player": {"melee": 3, "ranged": 3},
    "enemy": {"melee": 3, "ranged": 3}
  },
  "winner": null
}
```

---

## 10. Program Flow

### Game Start
```
[Setup Screen] Select spells/rune
  → Client: fetch champion JSON → create initial state
  → Save state, phase='skillup'
  → Skill selection UI (suggestions area)
  → POST /api/skillup
  → Server: validate + update state
  → When skillPoints=0: POST /api/plan → get player choices + enemy action
  → Cache enemy action, display player choices → enable input
```

### Normal Turn (Plan → Play → Resolve)
```
[Plan] POST /api/plan (gameState, history)
  → LLM: generate 3 player choices + 1 enemy action
  → Client: cache enemyAction, display playerActions as chips

[Play] Player clicks choice OR types free text

[Resolve] POST /api/turn (gameState, playerAction|input, enemyAction, history)
  → Server:
    1. LLM call (resolve) → hit/miss, elapsed, distance, narrative, aiChat
    2. Damage engine: damage/shield/resource consumption
    3. Elapsed-based cooldown reduction + resource recovery + HP regen
    4. CS accumulation → level-up check
    5. Guardrails
    6. gameOver check
  → Client:
    1. narrative → system message
    2. aiChat → opponent chat bubble
    3. state update → status bar render
    4. levelUp → skill selection UI → after skillup → POST /api/plan
    5. gameOver → game over overlay
    6. Normal → POST /api/plan → next turn choices
```

### Level-Up (mid-turn)
```
[Turn result includes levelUp]
  → Input disabled, skill selection buttons in suggestions area
  → POST /api/skillup → validate + update state
  → skillPoints 0 → POST /api/plan → new choices for updated state
```

### Game Over
```
[gameOver received]
  → LLM generates 3 practical tips based on match history
  → Overlay (win/loss + summary + tips)
  → New Game
```
- **Tips**: LLM analyzes recent combat history → 3 situational tips
- Tips returned as `tips` array in turn response when `gameOver` is present

---

## 11. UI/UX

### Setup Screen
- **Champion select** (grid of champion cards with portrait + name, from `data/champions/index.json`)
- Select 2 summoner spells
- Select 1 rune
- Start button

### Game Screen — KakaoTalk-style Chat
- **Yellow bubble** = my input (right)
- **White bubble** = opponent (left, champion profile image)
- **System message** = narration (center, date-divider style)
- Top: both sides' status (HP real values, resource, CS, level, cooldown icons, rune)
- Bottom: text input + suggestion chip buttons
- Skill-up: Q/W/E selection buttons in suggestions area + send disabled
- Game over: overlay (win/loss + summary + 3 match tips + restart)
- **Typing indicator**: animated dots bubble (enemy style) while waiting for LLM response
- **Unlearned skills**: shown as grayscale icons in status bar (opacity 0.3)
- **Suggestions layout**: vertical stack (one per line), left-aligned, shrink-to-fit text width
- **Skill-up buttons**: horizontal single row, same style as suggestion chips
- **No turn counter displayed**

### Icons
- **All local** (`src/img/champion/`, `src/img/spell/`, `src/img/rune/`)
- No external CDN dependencies — all images bundled in repo

---

## 12. Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla HTML/CSS/JS |
| Server | Vercel Serverless Functions (Node.js ESM) |
| LLM | Anthropic Claude (`claude-sonnet-4-6`, configurable via `LLM_MODEL` env) |
| Deploy | Vercel |
| Source | GitHub (`regrow1123/ib-lol-talk`) |

---

## 13. File Structure

```
ib-lol-talk/
├── src/
│   ├── index.html
│   ├── css/style.css
│   ├── js/main.js
│   ├── js/champion.js
│   ├── js/engine.js
│   ├── js/templates.js
│   └── js/minions.js
├── api/
│   ├── plan.js           # Plan phase (LLM: generate player choices + enemy action)
│   ├── turn.js           # Resolve phase (LLM: judge outcome + damage engine)
│   └── skillup.js        # Skill level-up (validation only, no LLM)
├── server/
│   ├── llm.js            # LLM API call + JSON parsing + retry
│   ├── prompt.js          # Prompt generation (static/dynamic split)
│   ├── damage.js          # Damage engine (LoL formulas) + elapsed time processing
│   ├── validate.js        # Guardrail validation (clamping)
│   ├── game.js            # State creation + initialization + level table
│   └── champions.js       # Champion JSON loader
├── data/
│   └── champions/
│       ├── index.json       # Champion list for select UI
│       └── lee-sin.json
├── docs/
│   └── PRD.md
├── vercel.json
└── package.json
```

---

## 14. API Endpoints

### POST /api/plan
- Input: `{gameState, history}`
- Output: `{playerActions: [...], enemyAction: {...}}`
- Flow: LLM (plan prompt) → 3 player choices + 1 enemy best action
- Called after: skillup completion, resolve completion (non-gameover)

### POST /api/turn (Resolve)
- Input: `{gameState, playerAction, enemyAction, history}` (choice click) OR `{gameState, input, enemyAction, history}` (free text)
- Output: `{state, narrative, aiChat, levelUp, gameOver, tips}`
- `enemyAction`: locked from plan phase, passed through by client
- Flow: LLM (resolve prompt) → actions + elapsed → damage engine + time processing → guardrails → response
- **No suggestions** in output (plan handles action generation)

### POST /api/skillup
- Input: `{gameState, skill}`
- Output: `{ok, state}`
- No LLM call

---

## 15. Roadmap

### Phase 1: Clean Reimplementation (current)
- [ ] Full code rewrite
- [ ] Prompt rewrite
- [ ] E2E testing
- [ ] LLM response quality tuning

### Phase 2: Polish
- [ ] AI behavior diversity improvement
- [ ] Balance tuning
- [ ] UI/UX improvements, mobile optimization

### Phase 3: Champion Expansion
- [x] Champion select UI on setup screen
- [ ] Add 2-3 more champions
- [ ] Asymmetric matchups
