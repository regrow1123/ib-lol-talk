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

### LLM 중심 구조
```
클라이언트(상태 보유) → 서버(LLM 호출 + 가드레일) → 클라이언트(상태 업데이트)
```

| 역할 | 담당 |
|------|------|
| **LLM** | 의도 해석, AI 행동 결정, 결과 판정, 상태 업데이트 생성, 서술, suggestions 생성 |
| **서버** | LLM API 호출, JSON 파싱, 가드레일 검증 (범위 체크), 레벨업 판정 |
| **클라이언트** | 전체 상태 보유, UI 렌더링, suggestions 필터링, 매 턴 서버에 상태 전송 |

### Stateless 서버
- Vercel Serverless Functions
- 상태 저장 안 함 — 매 턴 클라이언트가 전체 상태 전송

### 비용 최적화
- **Prompt caching**: static(챔피언 데이터+규칙) / dynamic(현재 상태) 분리 → cache_control
- **Diff 응답**: stateUpdate에 변경된 필드만 포함 → 토큰 절약
- **History 압축**: 최근 2턴 원문, 이전은 1줄 요약
- **max_tokens 800**: 응답은 간결해야 함
- **스킬업 시 추가 API 호출 없음**: suggestions를 스킬태그로 미리 받아 클라이언트에서 필터링

---

## 3. 게임 설계

### 3.1 HP 시스템
- **퍼센트 기반 (0~100%)**
- LLM이 스킬 특성 + 현재 상태 참고하여 피해량 판정
- 서버는 범위만 검증 (0 이하 → 0, 100 초과 → 100)

### 3.2 위치 시스템
그리드 좌표 없음. **한국어 상황 태그**:

| 태그 | 의미 | 관련 스킬 |
|------|------|-----------|
| 근접 | 1~2티모, AA/E/R 사거리 | AA, E1, R |
| 중거리 | 3~12티모, Q 사거리 내 | Q1 |
| 미니언뒤 | Q1 차단됨 | Q1 빗나감 |
| 수풀 | 시야 차단 | 기습 가능 |
| 타워사거리 | 타워 피해 받음 | 다이브 주의 |
| 원거리 | 12+티모, 사거리 밖 | 안전 |

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
- CS 기반 레벨 테이블:

| CS | 레벨 |
|----|------|
| 0 | 1 |
| 7 | 2 |
| 13 | 3 |
| 16 | 4 |
| 20 | 5 |
| 25 | 6 |
| 30 | 7 |
| 35 | 8 |
| 40 | 9 |

- 레벨업 시 `phase: 'skillup'` → 입력 비활성화 → 스킬 선택 → 완료 후 play
- 적 레벨업은 서버가 자동 스킬 배분 (Q > E > W 우선순위, R은 6/11/16)

### 3.5 승리 조건
- **킬**: 상대 HP 0%
- **CS 50**: 먼저 CS 50 도달
- **타워 파괴**: 상대 타워 체력 0%
- 동시 사망 없음 — 먼저 맞힌 쪽이 킬

### 3.6 기력(에너지) 시스템
- 최대 200
- 스킬 사용 시 소모 (Q1: 50, Q2: 25, W1: 50, E1: 50 등)
- 패시브(연타)로 회복: 스킬 후 AA 2회 시 기력 회복
- 턴마다 자연 회복

---

## 4. 상대방(AI) 시스템

### 4.1 성격
게임 시작 시 3가지 중 랜덤 배정:

| 성격 | 특징 | 읽을 수 있는 패턴 |
|------|------|-------------------|
| 호전적 (aggressive) | 킬각 과대평가, 자주 올인 | HP 60% 이하면 올인, 쿨 관리 허술 |
| 계산적 (calculated) | 유리할 때만 교전 | CS 차이 벌어지면 공격, 불리하면 파밍 |
| 반응적 (reactive) | 상대 행동에 대응 | 먼저 공격 안 함, 카운터 위주 |

### 4.2 행동 원칙
- **동등한 상대** — 봐주지 않음, 적극적으로 반격
- 플레이어 공격이 항상 성공하는 것 아님
- AI도 선공 가능
- 편파 판정 금지

### 4.3 말투
- 반말 종결: ~했음, ~됐음, ~인듯, ~ㅋㅋ
- "체" 글자 사용 금지
- 친근하게 + 대응 이유 + 팁
- "AI" 표현 금지 → "상대방"
- 예: "잘 피했음", "그거 좀 아팠음 ㅋㅋ", "Q2는 잃은 체력 비례라 지금 들어가면 더 아팠을듯"

### 4.4 교육적 역할
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
- 하드코딩된 스킬태그 suggestions (Q/W/E + 일반)
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
  "stateUpdate": { "변경된 필드만 포함 (diff)" },
  "suggestions": [
    {"skill": "Q", "text": "Q1으로 미니언 사이 빈틈 노려서 견제"},
    {"skill": null, "text": "안전하게 CS 챙기기"}
  ],
  "gameOver": null
}
```

### stateUpdate 가능 필드
- `playerHp`, `enemyHp` (0~100)
- `playerEnergy`, `enemyEnergy` (0~200)
- `playerCooldowns`, `enemyCooldowns` ({Q,W,E,R}: 턴 수)
- `playerPosition`, `enemyPosition` (한국어 태그)
- `playerCs`, `enemyCs` (감소 불가)
- `playerGold`, `enemyGold`
- `playerShield`, `enemyShield`
- `playerBuffs`, `enemyBuffs`, `playerDebuffs`, `enemyDebuffs`
- `playerSpellCooldowns`, `enemySpellCooldowns`
- `towerHp` ({player, enemy})
- `minions`

### 가드레일 (서버 검증)
- HP: 0~100 클램프
- 에너지: 0~200 클램프
- CS/레벨: 감소 불가
- 쿨다운: 0 이상
- 포지션: 유효 태그만

---

## 8. 챔피언 시스템

### 데이터 구조
`data/champions/{id}.json`에 독립 파일로 관리.

### 프롬프트 자동 생성
챔피언 JSON → `prompt.js`가 읽어서 프롬프트에 삽입.
챔피언 추가 시 코드 변경 불필요.

### 스킬 표기 규칙
항상 Q1/Q2/W1/W2/E1/E2/R로 표기 (Q/W/E 단독 사용 금지).

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
- 상단 또는 접이식: 양측 상태 (HP, 기력, CS, 레벨, 쿨다운 아이콘, 룬)
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
│   ├── validate.js       # 가드레일 검증
│   ├── game.js           # 상태 생성 + diff 머지
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
- LLM 호출 1회

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
