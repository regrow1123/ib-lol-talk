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
| **LLM** | Judgment | Intent interpretation, AI behavior, hit/miss, elapsed, distance/blocked, narration, suggestions |
| **Server (Damage Engine)** | Numeric calculation | Damage/shield calc from actions (LoL formulas), rune/spell effects, cooldown/resource management |
| **Server (Guardrails)** | Range validation | HP/resource/cooldown clamping, CS decrease prevention |
| **Client** | State + UI | Holds full state, sends to server each turn, UI rendering, suggestion filtering |

### 2.2 Core Principle

**LLM = what happened, Server = how much it hurts**

- LLM: "Q1 hit, followed up with Q2, opponent shielded with W1"
- Server: Q1 damage + Q2 damage - W1 shield = actual HP change
- LLM doesn't know numbers → no specific numbers needed in narration

### 2.3 Non-Fixed Time Model (elapsed)

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

### 2.4 Role Boundaries

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
| Suggestions | ✅ Generates | ❌ (client filters) |

### 2.5 Stateless Server
- Vercel Serverless Functions
- No state storage — client sends full state each turn

### 2.6 Cost Optimization
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

### 3.3 Turn System
- **1 turn = 1 player intent** (natural language input)
- Full combo processed in one turn
- Opponent also acts in the same turn
- **No RNG** — intent combinations fully determine outcomes

#### Auto-scaling Turn Granularity
| Situation | Processing |
|-----------|-----------|
| Both low intensity (farming/waiting) | Summarized (more time passes) |
| Either high intensity (combat) | Detailed (less time passes) |

#### Interrupt
- Player low intensity + AI high intensity → LLM handles via narration
- "Just as you go for the CS, the opponent fires Q1!" style
- No separate mechanism — LLM naturally expresses in actions and narrative
- Player's original intent interrupted, AI action takes priority in narration

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

## 6. Suggestions

### 6.1 Design Principles
- Suggestions must **reveal the reasoning/rationale/intent** behind the action
- Players learn laning judgment just by reading suggestions
- ❌ "Poke with Q1" → ✅ "Opponent Q is on cooldown, poke with Q1 now"
- **Written in player's first-person casual voice** (action declaration, not third-person advice)
  - ✅ "상대 Q 쿨 돌았으니 Q1 꽂아볼까"
  - ❌ "Q1으로 견제하세요" / "Q1을 사용하여 견제합니다"
- No emoji

### 6.2 Tag System
Each suggestion has two tags:

```json
{"requires": "Q", "ifLevelUp": null, "text": "상대 Q 쿨타임이니까 Q1으로 견제"}
{"requires": null, "ifLevelUp": "W", "text": "새로 배운 W1 쉴드 걸고 안전하게 진입"}
{"requires": null, "ifLevelUp": null, "text": "AA로 CS만 먹기"}
```

| Tag | Meaning | Usage |
|-----|---------|-------|
| `requires` | This skill must be available (learned + off cooldown) to execute | Client filters |
| `ifLevelUp` | Only shown when player levels up this specific skill | Post-skillup filtering |

### 6.3 LLM Generation Rules
- Generate **5-7** suggestions per turn
- Each includes `requires` and `ifLevelUp` tags
- `requires`: skill name if needed for execution, null otherwise
- `ifLevelUp`: if level-up is included this turn, generate suggestions for each learnable skill with corresponding tag. General suggestions use null.
- **Suggestion text includes action reasoning** (cooldown punish, HP advantage, distance, minion state, resource management, etc.)
- Output in priority order (best first)

### 6.4 Client Filtering
1. **Normal turn**: only `ifLevelUp: null` → filter by `requires` (learned + off cooldown) → max 3
2. **Level-up turn**: match `ifLevelUp` with chosen skill + `ifLevelUp: null` → `requires` filter → max 3
- Post-skillup: re-filter stored suggestions → **no additional API call**

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

## 8. LLM Response Format

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
  "enemySkillUp": null,
  "suggestions": [
    {"requires": "Q", "ifLevelUp": null, "text": "상대 Q 쿨타임이니까 Q1으로 견제"},
    {"requires": null, "ifLevelUp": null, "text": "미니언 뒤에서 안전하게 CS 챙기기"},
    {"requires": null, "ifLevelUp": "W", "text": "새로 배운 W1 쉴드로 안전하게 진입"}
  ]
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
  → Load initial suggestions from champion JSON (per chosen skill)
  → Filter suggestions → enable input
```
- Initial suggestions are pre-defined in `data/champions/{id}.json` per first skill choice (Q/W/E)
- No LLM call needed for first suggestions

### Normal Turn
```
[Player Input] "Q1으로 견제"
  → POST /api/turn (gameState, input, history)
  → Server:
    1. LLM call → actions, elapsed, distance, blocked, cs, ...
    2. Damage engine: damage/shield/resource consumption from actions
    3. Elapsed-based cooldown reduction + resource natural recovery + HP regen
    4. CS accumulation → level-up check
    5. Guardrails (HP/resource/cooldown clamping)
    6. gameOver check (HP 0 / CS 50)
  → Client:
    1. narrative → system message
    2. aiChat → opponent chat bubble
    3. state update → status bar render
    4. suggestions filter → chip buttons (max 3)
    5. levelUp → skill selection UI (input disabled)
    6. gameOver → game over overlay
```

### Level-Up (mid-turn)
```
[Turn result includes levelUp]
  → Input disabled, skill selection buttons in suggestions area
  → POST /api/skillup → validate + update state
  → skillPoints 0 → re-filter stored suggestions → enable input
  → skillPoints remaining → skill selection UI again
```

### Game Over
```
[gameOver received]
  → LLM generates 3 practical tips based on match history
  → Overlay (win/loss + summary + tips)
  → New Game
```
- **Tips**: LLM analyzes recent combat history → 3 situational tips (specific to what happened this game)
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
│   ├── turn.js           # Turn processing (LLM call + damage engine)
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

### POST /api/turn
- Input: `{gameState, input, history}`
- Output: `{state, narrative, aiChat, suggestions, levelUp, gameOver, tips}`
- `history`: array of past turns. Last 2 as full objects `{input, narrative, aiChat, actions}`, older turns as 1-line summary strings. Used for LLM context.
- Flow: LLM → actions + elapsed → damage engine + time processing → guardrails → response

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
