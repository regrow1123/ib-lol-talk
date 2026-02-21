# ib-lol talk — PRD (Product Requirements Document)

## 1. 제품 개요

LoL 1v1 라인전을 재현한 LLM 기반 텍스트 전략 게임.

**한줄 요약**: LLM과 채팅하면서 LoL 라인전을 배우는 게임.

### 타겟 유저
- LoL 관심있지만 진입장벽 높다고 느끼는 사람
- 챔피언 스킬/라인전 기본기를 텍스트로 먼저 익히고 싶은 사람
- 의도 싸움/심리전을 즐기는 LoL 경험자

### 핵심 경험
1. **자연어로 의도 입력** → 상대가 읽고 대응 → 진짜 읽기 싸움
2. **교전 서술에서 스킬 메커니즘 자연스럽게 설명** → 플레이하면서 배움
3. **상대방이 대응 이유 설명** → 실전 지식 축적

---

## 2. 아키텍처

### 하이브리드 구조
```
클라이언트(상태 보유) → 서버(LLM 호출 → 데미지 엔진 → 상태 업데이트) → 클라이언트
```

| 역할 | 담당 |
|------|------|
| **LLM** | 의도 해석, AI 행동 결정, 적중/회피 판정, 서술, suggestions 생성 |
| **서버 (데미지 엔진)** | 실제 수치 기반 데미지 계산, 스탯 적용, 기력/쿨다운 처리, 레벨업 판정 |
| **서버 (가드레일)** | HP/에너지 범위 클램프, CS/레벨 감소 방지 |
| **클라이언트** | 전체 상태 보유, UI 렌더링, suggestions 필터링, 매 턴 서버에 상태 전송 |

### 핵심 원칙: LLM = 무엇이 일어났는지, 서버 = 얼마나 아픈지
- LLM이 "Q1 맞았고 Q2로 따라감, 상대는 W1 쉴드로 방어" 판정
- 서버가 Q1 Lv2 데미지 + Q2 Lv2 데미지 - W1 쉴드량 계산
- LLM은 수치를 모름 → 서술에 구체적 숫자 안 넣어도 됨

### Stateless 서버
- Vercel Serverless Functions
- 상태 저장 안 함 — 매 턴 클라이언트가 전체 상태 전송

### 비용 최적화
- **Prompt caching**: static(챔피언 데이터+규칙) / dynamic(현재 상태) 분리 → cache_control
- **LLM은 수치 계산 안 함**: actions 배열만 출력 → 출력 토큰 절약
- **History 압축**: 최근 2턴 원문, 이전은 1줄 요약

### 프로그램 흐름

#### 게임 시작
```
[셋업 화면] 주문/룬 선택
    → POST /api/start (spells, rune)
    → 서버: 초기 상태 생성 (HP=maxHp, distance=800, blocked=true 등)
    → 클라이언트: state 저장, phase='skillup'
    → 스킬 선택 UI 표시 (suggestions 영역)
    → 스킬 선택 → POST /api/skillup
    → 서버: 검증 + 상태 업데이트
    → 클라이언트: suggestions 필터링 → 입력 활성화
```

#### 일반 턴
```
[플레이어 입력] "Q1으로 견제"
    → POST /api/turn (gameState, input, history)
    → 서버:
        1. LLM 호출 → {actions, distance, blocked, cs, narrative, aiChat, suggestions, ...}
        2. actions 검증 (미습득/쿨다운 중 스킬 → 무시)
        3. 데미지 엔진: actions 순서대로 데미지/쉴드/자원/쿨다운 계산
        4. CS 적용 → 레벨업 판정
        5. 가드레일 (HP/자원 클램프)
        6. gameOver 체크 (HP 0 / CS 50)
    → 클라이언트:
        1. narrative → 시스템 메시지
        2. aiChat → 상대방 말풍선
        3. state 업데이트 → 상태바 렌더링
        4. suggestions 저장 + 필터링 → 칩 버튼
        5. levelUp 있으면 → 스킬 선택 UI (입력 비활성화)
        6. gameOver 있으면 → 게임오버 오버레이
```

#### 레벨업 (턴 중간)
```
[턴 결과에 levelUp 포함]
    → 입력 비활성화, suggestions에 스킬 선택 버튼
    → 스킬 선택 → POST /api/skillup
    → 서버: 검증 + 상태 업데이트
    → skillPoints 0이면:
        → 저장된 suggestions 재필터링 (새 스킬 반영)
        → 입력 활성화
    → skillPoints 남으면:
        → 다시 스킬 선택 UI
```

#### 게임 오버
```
[gameOver 수신]
    → 게임오버 오버레이 (승패 + 요약)
    → 복기하기 → 채팅 로그 확인
    → 새 게임 → 셋업 화면으로
```

---

## 3. 게임 설계

### 3.1 HP 시스템
- **실제 수치 기반** (리신 Lv1: 645 HP, 레벨당 +108)
- UI에도 **실제 수치 표시** (예: 487 / 645)
- 데미지는 서버의 데미지 엔진이 실제 LoL 공식으로 계산
- LLM은 적중/회피만 판정, 수치 계산 안 함

### 3.2 거리 & 장애물 시스템
위치 태그 대신 **숫자 거리 + 장애물 유무**로 상황을 표현.

#### distance (숫자, 유닛)
두 챔프 간 거리. LLM이 매 턴 출력, 서버가 저장.
- 초기값: 800 (중거리 시작)
- LLM이 행동 결과에 따라 거리 변경 (돌진, 후퇴, 접근 등)

#### 스킬 사거리
각 챔피언의 스킬 사거리는 `data/champions/{id}.json`에 정의.
프롬프트 생성 시 챔피언 데이터에서 읽어 동적으로 삽입.

LLM은 `distance`와 스킬 사거리를 비교하여 적중/회피 판정.
- distance 300 + Q1(1200) → 사거리 내, 적중 가능
- distance 300 + AA(125) → 사거리 밖, AA 불가
- distance 100 + E1(450 반경) → 범위 내, 적중

#### blocked (boolean)
두 챔프 사이 미니언 유무.
- `true` → Q1 같은 직선 투사체가 미니언에 막힘
- `false` → 투사체 직통
- E1(자기 주변 범위), R/AA(대상지정)는 blocked 무관

### 3.3 턴 시스템
- **1턴 = 플레이어의 1개 의도**
- 콤보 전체가 1턴에 처리 (서술에서 스킬별로 풀어 설명)
- 상대방도 같은 턴에 대응 행동 실행
- **확률 요소 없음** — 의도 조합이 결과를 100% 결정

#### 턴 규모 자동 조절
| 상황 | 처리 |
|------|------|
| 양쪽 저강도 (파밍/대기) | 요약 처리 |
| 한쪽이라도 고강도 (교전) | 세밀하게 처리 |

#### 끼어들기 (Interrupt)
- 플레이어 저강도 + AI 고강도 → 턴 중단 + 대응 기회
- "CS를 먹으려는 순간, 상대가 Q1을 날렸다!" 식 연출

### 3.4 레벨업
- **서버가 100% 관리** (LLM 판정 아님)
- CS 기반 레벨 테이블 (초반 빠르고 후반 느림, 실제 LoL 템포):

| CS | 레벨 | 레벨당 필요 CS |
|----|------|---------------|
| 0 | 1 | - |
| 4 | 2 | 4 |
| 10 | 3 | 6 |
| 18 | 4 | 8 |
| 27 | 5 | 9 |
| 37 | 6 | 10 |
| 48 | 7 | 11 |

- 레벨업 시 `phase: 'skillup'` → 입력 비활성화 → 스킬 선택 → 완료 후 play
- 적 레벨업은 LLM이 스킬 선택 (`enemySkillUp` 필드) — 현재 상황에 맞게 판단, 서버는 유효성 검증만

### 3.5 승리 조건
- **킬**: 상대 HP 0
- **CS 50**: 먼저 CS 50 도달
- 동시 사망 없음 — 먼저 맞힌 쪽이 킬

### 3.6 자원 시스템
- 챔피언마다 다른 자원 타입 (마나, 기력, 무자원 등)
- 자원 관련 수치와 규칙은 `data/champions/{id}.json`에 정의
- 서버 데미지 엔진이 스킬 사용 시 자원 소모/회복 처리

### 3.7 미니언 시스템
- 일정 턴 간격으로 새 웨이브 도착 (근접 3 + 원거리 3)
- 미니언끼리 자동 교전 → 자연 소멸
- 플레이어/AI가 막타를 쳐야 CS로 인정
- 미니언 유무가 `blocked` 상태에 영향 (미니언 있으면 투사체 차단)
- 미니언 수는 LLM이 actions의 CS와 함께 관리, 서버가 상태에 반영

### 3.8 게임 상태 스키마

```json
{
  "turn": 1,
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
    "gold": 0,
    "ad": 69,
    "armor": 36,
    "mr": 32,
    "skillLevels": { "Q": 0, "W": 0, "E": 0, "R": 0 },
    "skillPoints": 1,
    "cooldowns": { "Q": 0, "W": 0, "E": 0, "R": 0 },
    "shield": 0,
    "spells": ["flash", "ignite"],
    "spellCooldowns": [0, 0],
    "rune": "conqueror",
    "buffs": [],
    "debuffs": []
  },
  "enemy": {
    "...same structure..."
  },
  "minions": {
    "player": { "melee": 3, "ranged": 3 },
    "enemy": { "melee": 3, "ranged": 3 }
  },
  "winner": null
}
```

**주요 변경 (이전 대비)**:
- `hp`: 퍼센트(0~100) → 실제 수치 (645, 753, ...)
- `resource` / `resourceType`: 기력 하드코딩 → 챔피언별 자원
- `ad`, `armor`, `mr`: 서버 데미지 엔진이 참조하는 전투 스탯
- `distance`, `blocked`: 상태 최상위 레벨 (양측 공유)
- `tower` 필드 제거

---

## 4. 상대방(AI) 시스템

### 4.1 행동 원칙
- **동등한 상대** — 봐주지 않음, 적극적으로 반격
- 플레이어 공격이 항상 성공하는 것 아님
- AI도 선공 가능
- 편파 판정 금지
- **고정된 성격 없음** — 매 턴 현재 상태(HP, 쿨다운, 거리, CS 차이)에 따라 유동적으로 판단
- **다양한 상황 연출이 목표** — 같은 패턴 반복 X, 다양한 스킬 조합/전략을 적극 사용하여 플레이어가 여러 상황을 경험하게 함

### 4.2 말투
- 반말 종결: ~했음, ~됐음, ~인듯, ~ㅋㅋ
- 친근하게 + 대응 이유 + 팁
- 예: "잘 피했음", "그거 좀 아팠음 ㅋㅋ", "Q2는 잃은 체력 비례라 지금 들어가면 더 아팠을듯"

### 4.3 교육적 역할 (핵심 목표)
- 각 스킬의 고유 효과를 상황에 맞게 활용 → 플레이어가 체험으로 배움
- 다양한 스킬 조합 활용 (같은 패턴 반복 X)
- 대응 이유를 설명하여 실전 지식 전달

---

## 5. Suggestions 시스템

### 5.1 LLM 생성
- 턴 응답에 **5~7개** suggestions 포함
- **스킬 태그 포함**: `[{skill: "Q", text: "..."}, {skill: null, text: "..."}]`
- 미습득 스킬 포함 OK (클라이언트가 필터)

### 5.2 클라이언트 필터링
- 습득 여부 + 쿨다운 기준 필터링
- 필터 후 **최대 3개** 표시
- 이모지 사용 금지
- 읽기/심리전 느낌 (상대 행동 예측 포함)
- 교육적 근거 포함

### 5.3 스킬업 후 재필터링
- 레벨업 → 스킬 선택 → 저장된 suggestions 재필터링 → 새 스킬 관련 suggestion 노출
- **추가 API 호출 없음**

### 5.4 게임 시작 시
- 챔피언 데이터 기반 스킬태그 suggestions (각 스킬 + 일반)
- 스킬 안 배운 상태 → 일반 suggestions만 표시
- 스킬업 후 해당 스킬 suggestions 노출

---

## 6. 소환사 주문 & 룬

### 소환사 주문 (5개 중 2개 자유 선택)
| 주문 | 효과 |
|------|------|
| 점멸 (Flash) | 즉시 이동, 회피/기습 |
| 점화 (Ignite) | 지속 피해 + 치유 감소 |
| 탈진 (Exhaust) | 둔화 + 피해 35% 감소 |
| 방어막 (Barrier) | 즉시 보호막 |
| 텔레포트 (TP) | 귀환 후 빠른 복귀 |

### 룬 (3개 중 1개 선택)
| 룬 | 특성 |
|------|------|
| 정복자 | 장기 교전. 스택 → AD 증가 + 회복 |
| 감전 | 짧은 교전. 3히트 시 추가 폭딜 |
| 착취의 손아귀 | 지속 체력전. AA → 추가 피해 + 회복 + 영구 체력 |

---

## 7. LLM 응답 형식

```json
{
  "narrative": "교전 서술 1~2문장. 스킬 효과 설명 포함.",
  "aiChat": "상대방 코멘트. ~했음/~됐음 체. 대응 이유 + 팁.",
  "actions": [
    {"who": "player", "skill": "Q1", "target": "enemy", "hit": true},
    {"who": "player", "skill": "AA", "target": "enemy", "hit": true},
    {"who": "player", "skill": "Q2", "target": "enemy", "hit": true},
    {"who": "enemy", "skill": "E1", "target": "player", "hit": true}
  ],
  "distance": 100,
  "blocked": false,
  "cs": {"player": 2, "enemy": 1},
  "enemySkillUp": null,
  "suggestions": [
    {"skill": "Q", "text": "Q1으로 미니언 사이 빈틈 노려서 견제"},
    {"skill": null, "text": "안전하게 CS 챙기기"}
  ],
  "gameOver": null
}
```

### LLM이 결정하는 것
- `actions`: 어떤 스킬이 사용됐고, 맞았는지 빗나갔는지
- `distance`: 턴 후 두 챔프 간 거리 (숫자, 유닛)
- `blocked`: 두 챔프 사이 미니언 유무
- `cs`: 이번 턴에 획득한 CS 수
- `enemySkillUp`: 적 레벨업 시 스킬 선택 (AI 성격/상황 기반)
- `narrative`, `aiChat`: 서술과 상대방 코멘트
- `suggestions`: 다음 행동 추천

### 서버(데미지 엔진)가 계산하는 것
- `actions` 기반 실제 데미지 (LoL 공식: base + scaling × 스탯)
- 방어력/마저 적용 (물리: 100/(100+armor), 마법: 100/(100+mr))
- 자원 소모/회복 (챔피언별 자원 타입에 따라)
- 쿨다운 적용 (사용한 스킬에 레벨별 쿨다운 설정)
- 쉴드 계산
- 패시브 효과 (챔피언 데이터에 정의)
- 룬 효과 (정복자 스택/감전 발동/착취 회복)
- 소환사 주문 효과 (점화 지속딜, 탈진 피해감소 등)
- HP/자원 클램프

### 가드레일 (서버 검증)
- HP: 0~maxHp 클램프
- 자원: 0~maxResource 클램프 (챔피언별 상한)
- CS/레벨: 감소 불가
- 쿨다운: 0 이상
- distance: 0 이상
- 미습득/쿨다운 중 스킬 사용 시 해당 action 무시

---

## 8. 챔피언 시스템

### 데이터 구조
`data/champions/{id}.json`에 독립 파일로 관리.

### 프롬프트 자동 생성
챔피언 JSON → `prompt.js`가 읽어서 프롬프트에 삽입.
챔피언 추가 시 코드 변경 불필요.

### 스킬 표기 규칙
- Q/W/E는 **2단계 재사용(recast) 스킬** — 1단계 사용 후 조건 충족 시 2단계 재사용 가능
- 표기: Q1/Q2, W1/W2, E1/E2 (1단계/2단계)
- Q1→Q2는 **하나의 스킬 Q의 2단 사용**이지, 별개 스킬이 아님
- 쿨다운은 Q 전체에 하나 (Q2 사용 후 또는 Q1 시간 만료 후 쿨다운 시작)
- 기력도 Q 전체로 관리 (Q1: 50, Q2: 25 — 합계 75)
- R은 단일 스킬 (recast 없음)
- 챔피언마다 recast 구조가 다를 수 있음 — `data/champions/{id}.json`에 정의

### 챔피언 추가 절차
1. `data/champions/{id}.json` 작성
2. 셋업 화면에 추가
3. 끝

---

## 9. UI/UX

### 셋업 화면
- 소환사 주문 2개 선택 (DDragon 실제 아이콘)
- 룬 1개 선택 (DDragon 실제 아이콘)
- 시작 버튼

### 게임 화면 — KakaoTalk 스타일 채팅
- **노란 말풍선** = 내 입력 (오른쪽)
- **흰 말풍선** = 상대방 (왼쪽, 리신 프로필 이미지)
- **시스템 메시지** = 서술 (중앙, 날짜 구분선 스타일)
- 상단 또는 접이식: 양측 상태 (HP, 자원, CS, 레벨, 쿨다운 아이콘, 룬)
- 하단: 텍스트 입력 + suggestions 칩 버튼
- 스킬업 시: suggestions 영역에 Q/W/E 선택 버튼 + 전송 비활성화
- 게임오버: 오버레이 (승패 + 요약 + 복기/재시작)
- 턴 번호 표시 안 함

### 아이콘
- DDragon CDN (`https://ddragon.leagueoflegends.com/cdn/14.20.1`)
- 스킬/주문/룬/챔피언 초상화 모두 실제 게임 이미지

---

## 10. 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | 바닐라 HTML/CSS/JS |
| 서버 | Vercel Serverless Functions (Node.js ESM) |
| LLM | Anthropic Claude (claude-sonnet-4-6, LLM_MODEL env로 변경 가능) |
| 배포 | Vercel |
| 소스 | GitHub (regrow1123/ib-lol-talk) |

---

## 11. 파일 구조

```
ib-lol-talk/
├── src/
│   ├── index.html
│   ├── css/style.css
│   └── js/main.js
├── api/
│   ├── start.js          # 게임 시작
│   ├── turn.js           # 턴 처리 (LLM 호출)
│   └── skillup.js        # 스킬 레벨업 (검증만)
├── server/
│   ├── llm.js            # LLM API 호출 + JSON 파싱 + 재시도
│   ├── prompt.js         # 프롬프트 생성 (static/dynamic 분리)
│   ├── damage.js         # 데미지 엔진 (LoL 공식 기반 수치 계산)
│   ├── validate.js       # 가드레일 검증
│   ├── game.js           # 상태 생성 + 초기화
│   └── champions.js      # 챔피언 JSON 로더
├── data/
│   └── champions/
│       └── lee-sin.json
├── docs/
│   └── PRD.md
├── vercel.json
└── package.json
```

---

## 12. API 엔드포인트

### POST /api/start
- Input: `{spells: [2개], rune: string}`
- Output: `{state, narrative, suggestions}`
- LLM 호출 없음

### POST /api/turn
- Input: `{gameState, input, history}`
- Output: `{state, narrative, aiChat, suggestions, levelUp, gameOver}`
- 처리 흐름: LLM 호출 → actions 추출 → 데미지 엔진 → 상태 업데이트 → 가드레일 검증

### POST /api/skillup
- Input: `{gameState, skill}`
- Output: `{ok, state}`
- LLM 호출 없음 (검증만)

---

## 13. 로드맵

### Phase 1: 클린 재구현 (현재)
- [ ] 전체 코드 재작성 (V3 잔재 제거)
- [ ] 프롬프트 재작성
- [ ] E2E 테스트
- [ ] LLM 응답 품질 튜닝

### Phase 2: 폴리시
- [ ] AI 행동 다양성 개선
- [ ] 밸런스 튜닝
- [ ] UI/UX 개선, 모바일 최적화

### Phase 3: 챔피언 확장
- [ ] 셋업 화면 챔피언 선택 UI
- [ ] 2~3개 챔피언 추가
- [ ] 비대칭 매치업
