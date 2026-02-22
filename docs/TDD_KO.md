# ib-lol talk — 기술 설계 문서 (TDD 한국어)

> ⚠️ 이 문서는 읽기 전용. 수정은 영어 원본 `TDD.md`에서만.

## 1. 개요

하이브리드 LLM 텍스트 전략 게임의 구현 가이드. 서버 모듈, 클라이언트 아키텍처, 데이터 흐름, 에지 케이스를 다룸.

게임 기획은 [PRD.md](./PRD.md) 참고.

---

## 2. 시스템 흐름

### 2.1 턴 처리 파이프라인

```
클라이언트                        서버
  │                               │
  ├─ POST /api/turn ─────────────►│
  │  {gameState, input, history}  │
  │                               ├─ 1. buildPromptParts(gameState)
  │                               │     → 정적 프롬프트 (캐시) + 동적 프롬프트
  │                               ├─ 2. callLLM(gameState, input, history)
  │                               │     → {actions, elapsed, distance, blocked, cs,
  │                               │        minions, narrative, aiChat, suggestions,
  │                               │        enemySkillUp}
  │                               ├─ 3. applyActions(state, llmResult)
  │                               │     ├─ 각 액션마다:
  │                               │     │   ├─ validateAction (배웠나? 쿨다운?)
  │                               │     │   ├─ calculateSkillEffect (데미지/쉴드)
  │                               │     │   ├─ applyDamage (쉴드 흡수 → HP)
  │                               │     │   ├─ consumeResource (에너지 소모)
  │                               │     │   └─ applyCooldown (첫 시전 시 쿨 설정)
  │                               │     ├─ elapsed → 초 변환
  │                               │     ├─ decrementCooldowns (스킬 + 주문 쿨 감소)
  │                               │     ├─ recoverResource (에너지 50/초 × elapsed)
  │                               │     ├─ recoverHp (HP리젠 × elapsed)
  │                               │     ├─ distance, blocked, CS, minions 업데이트
  │                               │     └─ decayShields (쉴드 잔여시간 감소)
  │                               ├─ 4. validateState(state) — 가드레일
  │                               ├─ 5. 레벨업 체크 (CS → 레벨 테이블)
  │                               │     ├─ 플레이어: phase='skillup', skillPoints 추가
  │                               │     └─ 적: LLM의 enemySkillUp 적용
  │                               ├─ 6. 게임 오버 체크 (HP 0 / CS 50)
  │                               │
  │◄─ {state, narrative, aiChat, ─┤
  │    suggestions, levelUp,      │
  │    gameOver}                  │
  │                               │
  ├─ UI 렌더링                     │
  └─ 상태 로컬 저장                │
```

### 2.2 스킬업 흐름 (LLM 호출 없음)

```
클라이언트                        서버
  │                               │
  ├─ POST /api/skillup ──────────►│
  │  {gameState, skill}           │
  │                               ├─ 검증: skillPoints > 0, 랭크 < 최대,
  │                               │        R은 6/11/16렙에만
  │                               ├─ skillLevels[skill]++, skillPoints--
  │                               ├─ skillPoints == 0이면: phase = 'play'
  │◄─ {ok, state} ───────────────┤
  │                               │
  ├─ 저장된 suggestions 재필터링    │
  └─ play 단계면 입력 활성화        │
```

---

## 3. 모듈 명세

### 3.1 `server/damage.js` — 데미지 엔진

**진입점**: `applyActions(state, llmResult) → 변경된 state`

#### 처리 순서 (순서 중요!)
1. **액션 루프** (LLM이 준 순서대로):
   - `validateAction()` — 미학습이거나 유효하지 않은 키면 스킵
   - 빗나감: 자원 소모 + 쿨다운 설정, 데미지 스킵
   - 적중: 데미지/쉴드 계산 → 데미지 적용 → 쉴드 추가 → 자원 소모 → 쿨다운 설정
2. **경과 시간 처리**:
   - `llmResult.elapsed`를 `ELAPSED_MAP`으로 초 변환
   - 유효하지 않으면 `medium` (6초) 기본값
3. **쿨다운 차감** — 모든 스킬/주문 쿨이 elapsed초만큼 감소
4. **자원 회복** — 에너지: 50/초 × elapsed (최대치 캡)
5. **HP 리젠** — (기본리젠 + 레벨당리젠 × (레벨-1)) × elapsed (최대HP 캡)
6. **상태 갱신** — LLM의 distance, blocked, CS, minions 반영
7. **쉴드 감소** — 각 쉴드의 `remaining`이 elapsed만큼 줄고, 만료되면 제거

#### 경과 시간 매핑
| 키 | 초 | 상황 |
|----|-----|------|
| `instant` | 1 | 단일 스킬 교환 |
| `short` | 3 | 짧은 콤보/교전 |
| `medium` | 6 | CS + 소규모 행동 |
| `long` | 10 | 파밍 구간 |
| `very_long` | 15 | 긴 대치 |

#### 데미지 계산
```
원본데미지 = baseDamage[페이즈][랭크-1] + (스탯값 × 계수)

// Q2 특수: 잃은 체력 비례 보너스
if Q2: 원본데미지 × (1 + 잃은체력비율)   // 풀피시 1배, 0HP시 2배

// 저항 적용
물리: 원본데미지 × 100/(100 + 방어력)
마법: 원본데미지 × 100/(100 + 마저)
고정: 원본데미지 (감소 없음)
```

#### 쉴드 시스템
- `shields: [{amount, remaining, source}]` — 배열, 여러 개 공존 가능
- 데미지 받을 때: 가장 오래된 쉴드부터 소모 (FIFO)
- 쉴드 지속시간은 챔피언 데이터의 `shieldDuration` (기본 2초)
- 매 턴 elapsed만큼 감소

#### 쿨다운 규칙
- 쿨다운은 **첫 시전 시** 설정 (Q1이 Q 쿨다운을 건다)
- Q1 → Q2: 쿨다운 이미 돌고 있으므로 리셋 안 함
- 쿨다운 값: `skillData.cooldown[랭크-1]`
- 매 턴 elapsed초만큼 차감

#### 자원 소모
- 비용: `skillData.cost[페이즈]` (페이즈 0 = 첫 시전, 1 = 재시전)
- 적중/빗나감 **모두** 소모
- AA는 자원 비용 없음

### 3.2 `server/validate.js` — 가드레일

**진입점**: `validateState(state) → 클램프된 state`

클램프 대상:
- `hp`: 0 ~ maxHp (반올림)
- `resource`: 0 ~ maxResource (반올림)
- `cooldowns[key]`: ≥ 0
- `spellCooldowns[i]`: ≥ 0
- `distance`: ≥ 0

### 3.3 `server/prompt.js` — 프롬프트 생성

**진입점**: `buildPromptParts(gameState) → {staticPrompt, dynamicPrompt}`

#### 정적 프롬프트 (cache_control로 캐시)
턴마다 안 변하는 것:
- 게임 규칙, AI 행동 원칙
- 챔피언 스킬 설명 (JSON에서)
- 스킬 사거리 표
- 재시전 규칙, 콤보 팁
- 거리 & blocked 설명
- 출력 JSON 형식 (elapsed, minions, requires/ifLevelUp 포함)
- 제안 생성 규칙
- AI 말투 규칙

언어: 영어 지시 + 한국어 출력 예시

#### 동적 프롬프트 (매 턴 변경)
- 현재 거리, blocked 상태
- 양측: HP, 자원, 레벨, CS, AD, 방어력, 마저
- 쉴드 상태 (배열 요약)
- 스킬 레벨 + 사용 가능 여부
- 주문 상태 (이름 + 쿨다운)
- 룬
- 미니언 수

### 3.4 `server/llm.js` — LLM 통합

**진입점**: `callLLM(gameState, input, history) → 파싱된 LLM 응답`

#### 재시도 로직
- 최대 2회 재시도 (총 3회 시도)
- 인증/결제 에러 (401/402/403): 재시도 안 함
- `stop_reason === 'max_tokens'`: 재시도 안 함, 폴백 반환
- 파싱 실패: 재시도

#### JSON 추출 (3단계)
1. `JSON.parse(text)` 직접 시도
2. 마크다운 코드 블록에서 추출 `` ```json ... ``` ``
3. 수동 중괄호 매칭 (첫 `{` 찾아서 닫는 `}` 매칭)

#### 히스토리 압축
- 최근 4개 메시지 (2턴)는 원본 그대로
- 이전 메시지는 1줄 요약: `action1 → action2 → ...`

#### 폴백 응답
모든 재시도 실패 시 안전한 중립 응답:
- 액션 없음, CS 변화 없음
- 현재 distance/blocked/minions 유지
- `elapsed: "medium"`
- 범용 안전 suggestions (requires/ifLevelUp 태그 포함)

### 3.5 `server/game.js` — 상태 초기화

**진입점**: `createGameState(championId, spells, rune) → 초기 state`

#### 초기 상태
- `phase: 'skillup'` (첫 스킬 선택)
- `distance: 800`, `blocked: true`
- 양측: 풀 HP, 풀 자원, 모든 스킬 레벨 0, skillPoint 1개
- `shields: []`
- 미니언: 양측 각 근접3 + 원거리3
- 적: 3개 룬 중 랜덤 + 5개 주문 중 랜덤 2개

#### 레벨 테이블: `csToLevel(cs) → 레벨`
| CS 범위 | 레벨 |
|---------|------|
| 0-3 | 1 |
| 4-9 | 2 |
| 10-17 | 3 |
| 18-26 | 4 |
| 27-36 | 5 |
| 37-47 | 6 |
| 48+ | 7 |

#### 스탯 재계산: `recalcStats(fighter, championId)`
레벨업 시:
```
maxHp = 기본HP + 레벨당HP × (레벨 - 1)
ad = 기본AD + 레벨당AD × (레벨 - 1)
baseAd = ad (아이템 없으므로 동일 — 룬 bonusAD 계산용으로 분리 유지)
armor = 기본방어력 + 레벨당방어력 × (레벨 - 1)
mr = 기본마저 + 레벨당마저 × (레벨 - 1)
```
HP 비례 유지: `hp = round(체력비율 × 새maxHp)`

### 3.6 `server/champions.js` — 챔피언 데이터 로더

단순 JSON 로더 + 인메모리 캐시.
- `loadChampion(id)` → `data/champions/{id}.json` 파싱
- 첫 로드 후 캐시 (서버리스 콜드 스타트 최적화)

---

## 4. API 엔드포인트

### 4.1 POST /api/turn

#### 요청
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

`history`: 과거 턴의 user/assistant 메시지 쌍 배열. 최근 2턴(4메시지)은 원본, 이전 턴은 1줄 요약.

#### 응답
```json
{
  "state": { ... },
  "narrative": "...",
  "aiChat": "...",
  "suggestions": [...],
  "levelUp": null | {"newLevel": 2, "who": "player"},
  "gameOver": null | {"winner": "player", "reason": "kill", "summary": "..."}
}
```

#### 서버 처리 순서
1. LLM 호출 → actions, elapsed 등 받기
2. state 딥카피
3. `applyActions(state, llmResult)` — 데미지, 쿨다운, 자원, HP리젠, 쉴드
4. `validateState(state)` — 가드레일
5. 양측 레벨업 체크 (CS → 레벨 테이블)
   - 플레이어: skillPoints 추가, phase='skillup'
   - 적: LLM의 `enemySkillUp` 적용 (폴백: 자동 스킬업)
6. 게임 오버 체크 — **서버가 판정** (HP 0 또는 CS 50), LLM 무시
7. 갱신된 state + LLM narrative/suggestions 반환

#### 에러 응답
- `400`: gameState 또는 input 누락
- `405`: POST가 아님
- `500`: 서버/LLM 에러

### 4.2 POST /api/skillup

#### 요청
```json
{
  "gameState": { ... },
  "skill": "Q"
}
```

#### 응답
```json
{
  "ok": true,
  "state": { ... }
}
```

#### 검증 규칙
- `skillPoints > 0`
- `skillLevels[skill] < 최대랭크` (Q/W/E는 5, R은 3)
- R은 레벨 6/11/16에만

---

## 5. 클라이언트 아키텍처

### 5.1 게임 상태 초기화
클라이언트 측 (서버 호출 없음):
1. `data/champions/{id}.json` 가져오기
2. 챔피언 기본 스탯 + 선택한 주문 + 룬으로 초기 state 생성
3. `phase: 'skillup'` 설정
4. 스킬 선택 UI 표시

### 5.2 상태 관리
- 전체 게임 상태를 메모리(JS 변수)에 저장
- 매 턴 서버에 전송
- 서버 응답으로 갱신
- history 배열 로컬 관리

### 5.3 제안 필터링 로직

```javascript
function filterSuggestions(suggestions, player, levelUpSkill = null) {
  return suggestions
    .filter(s => {
      // 레벨업 필터링
      if (levelUpSkill) {
        // 레벨업 시: ifLevelUp이 선택한 스킬이거나 null인 것만
        if (s.ifLevelUp !== null && s.ifLevelUp !== levelUpSkill) return false;
      } else {
        // 일반 턴: ifLevelUp이 null인 것만
        if (s.ifLevelUp !== null) return false;
      }
      // requires 필터링
      if (s.requires) {
        const key = s.requires;
        if (player.skillLevels[key] <= 0) return false;  // 미학습
        if (player.cooldowns[key] > 0) return false;      // 쿨다운 중
      }
      return true;
    })
    .slice(0, 3);  // 최대 3개
}
```

### 5.4 초기 제안 (게임 시작)
- 첫 스킬업 후, `championData.initialSuggestions[선택한스킬]`에서 로드
- LLM 호출 불필요
- LLM 제안과 동일한 태그 형식 (requires/ifLevelUp)

### 5.5 히스토리 관리
```javascript
// 각 턴 응답 후:
history.push({ role: 'user', content: playerInput });
history.push({ role: 'assistant', content: JSON.stringify({
  narrative, aiChat, actions
}) });
// 전체 history 배열을 서버에 전송
// 서버가 압축 처리 (최근 4개 원본, 이전 것은 요약)
```

### 5.6 UI 상태 머신

```
SETUP → SKILLUP → PLAY ⟷ SKILLUP → GAMEOVER
                    ↑                    │
                    └────────────────────┘ (새 게임)
```

| 단계 | 입력 | 제안 영역 | 상태바 |
|------|------|----------|--------|
| `setup` | 비활성 | 주문/룬 선택 | 숨김 |
| `skillup` | 비활성 | Q/W/E 스킬 버튼 | 표시 |
| `play` | 활성 | 필터된 제안 (최대 3개) | 표시 |
| `gameover` | 비활성 | 숨김 | 표시 |

---

## 6. 챔피언 데이터 스키마

### `data/champions/{id}.json`

```jsonc
{
  "id": "lee-sin",
  "name": "리신",
  "nameEn": "Lee Sin",
  "resource": "energy",            // energy | mana | none
  "resourceMax": 200,

  "baseStats": {
    "hp": 645,                     // 기본 체력
    "hpPerLevel": 108,             // 레벨당 체력
    "hpRegen": 0.7,                // 초당 HP 리젠
    "hpRegenPerLevel": 0.13,
    "ad": 69,                      // 기본 공격력
    "adPerLevel": 3.7,
    "armor": 36,                   // 기본 방어력
    "armorPerLevel": 4.9,
    "mr": 32,                      // 기본 마법 저항력
    "mrPerLevel": 2.05,
    "attackRange": 125,             // 기본 사거리
    "moveSpeed": 345
  },

  "passive": {
    "name": "연타",
    "description": "...",
    "energyRestore": [20, 30, 40],       // 패시브 에너지 회복량
    "energyRestoreLevels": [1, 7, 13]    // 회복량 증가 레벨
  },

  "skills": {
    "Q": {
      "name": ["음파", "공명타"],          // [1단계, 2단계]
      "recast": true,                     // 재시전 스킬 여부
      "range": [1200, 0],                 // [1단계, 2단계] (0 = 대상에게 돌진)
      "baseDamage": [
        [55, 80, 105, 130, 155],          // Q1 랭크별
        [55, 80, 105, 130, 155]           // Q2 랭크별
      ],
      "scaling": [
        {"stat": "bonusAD", "ratio": 1.0},  // Q1 계수
        {"stat": "bonusAD", "ratio": 1.0}   // Q2 계수
      ],
      "damageType": ["physical", "physical"],
      "cost": [50, 25],                   // [1단계, 2단계] 에너지 비용
      "cooldown": [11, 10, 9, 8, 7],      // 랭크별 쿨다운(초)
      "description": ["Q1: ...", "Q2: ..."]
    },
    "W": {
      "recast": true,
      "shield": [55, 110, 165, 220, 275],  // 랭크별 쉴드량
      "shieldDuration": 2,                   // 쉴드 지속시간(초)
      // ... 비슷한 구조
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

## 7. 프롬프트 설계

### 7.1 구조

```
시스템 메시지:
  [1] 정적 프롬프트 (cache_control: ephemeral)
      - 게임 규칙
      - 챔피언 데이터 (스킬, 사거리, 콤보)
      - 출력 형식 명세
      - AI 행동 규칙
      - 제안 생성 규칙 (requires/ifLevelUp 태그)
  [2] 동적 프롬프트
      - 현재 게임 상태 (HP, 자원, 쿨다운, 거리 등)
      - 쉴드 상태 (배열 요약)
      - 미니언 수

유저 메시지:
  [이전 턴 요약]
  [최근 2턴 원본]
  [현재 플레이어 입력]
```

### 7.2 핵심 프롬프트 지시사항
- 출력은 반드시 유효한 JSON (마크다운 래핑 금지)
- `elapsed`: 행동 강도에 따라 instant/short/medium/long/very_long 중 선택
- `actions`: 양측의 모든 행동을 시간순으로 포함
- `suggestions`: 5-7개, requires/ifLevelUp 태그 포함, 텍스트에 판단 근거 포함
- 레벨업 턴: 배울 수 있는 각 스킬에 대해 `ifLevelUp` 제안 생성
- `enemySkillUp`: 적에게 skillPoints 있으면 반드시 스킬 키 선택
- 스킬 표기: 항상 Q1/Q2, 절대 Q만 쓰지 않음
- 한국어 출력: narrative, aiChat, suggestions 텍스트

### 7.3 프롬프트 언어
- 지시사항: 영어 (LLM 이해도 + 토큰 효율)
- 출력 예시: 한국어 (톤 설정)
- 챔피언 데이터: 한국어 이름/설명 OK

---

## 8. 에러 처리

### 8.1 LLM 실패
| 실패 유형 | 처리 |
|-----------|------|
| API 타임아웃 | 2회 재시도, 이후 폴백 |
| 인증 에러 (401/402/403) | 재시도 안 함, 즉시 폴백 |
| JSON 파싱 실패 | 2회 재시도, 이후 폴백 |
| max_tokens 잘림 | 재시도 안 함, 폴백 |
| 유효하지 않은 elapsed | `medium` (6초) 기본값 |
| 필드 누락 | 기본값 사용 (distance=현재값, cs={0,0} 등) |

### 8.2 클라이언트 측
| 문제 | 처리 |
|------|------|
| 네트워크 에러 | 에러 토스트 표시, 재시도 허용 |
| 유효하지 않은 state | 셋업 화면으로 리셋 |
| 필터링 후 제안 없음 | 범용 "CS 챙기기" 폴백 표시 |

---

## 9. 구현 체크리스트

### 9.1 서버
- [ ] `server/champions.js` — 챔피언 JSON 로더 + 캐시
- [ ] `server/game.js` — createGameState(), recalcStats(), csToLevel()
- [ ] `server/damage.js` — 풀 데미지 엔진 (actions → elapsed → recovery → shields)
- [ ] `server/validate.js` — 가드레일 클램핑
- [ ] `server/prompt.js` — 정적/동적 프롬프트 빌더 (영어 지시)
- [ ] `server/llm.js` — Anthropic API 호출, JSON 추출, 재시도, 폴백

### 9.2 API
- [ ] `api/turn.js` — LLM → 데미지 엔진 → 레벨업 → 게임오버 → 응답
- [ ] `api/skillup.js` — 스킬 검증 + 상태 갱신

### 9.3 클라이언트
- [ ] `src/js/main.js` — 상태 초기화, API 호출, 제안 필터링, 히스토리
- [ ] `src/css/style.css` — 카카오톡 채팅 UI
- [ ] `src/index.html` — 레이아웃 (셋업, 채팅, 상태바)

### 9.4 데이터
- [ ] `data/champions/lee-sin.json` — initialSuggestions 포함 풀 챔피언 데이터

### 9.5 효과 (후순위)
- [ ] 소환사 주문 효과 (플래시 거리, 점화 DoT, 탈진 감소, 방벽 쉴드, TP)
- [ ] 룬 효과 (정복자 스택/AD/힐, 감전 폭발, 착취 힐/영구HP)
- [ ] 패시브 효과 (리신 연타 — 스킬 후 AA 에너지 회복)

### 9.6 테스트
- [ ] 데미지 계산 유닛 테스트
- [ ] 쉴드 흡수 + 감소 테스트
- [ ] 경과 시간 처리 테스트
- [ ] 제안 필터링 테스트
- [ ] E2E: 전체 게임 흐름 (셋업 → 스킬업 → 턴 → 게임오버)
