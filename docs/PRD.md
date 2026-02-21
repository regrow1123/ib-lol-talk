# ib-lol talk — Product Requirements Document (PRD)

## 1. 제품 개요

**ib-lol talk**은 리그 오브 레전드(LoL)의 1v1 라인전을 텍스트 기반 인터랙티브 픽션으로 재현한 웹 게임이다.

**핵심 가치**: 의도 싸움(읽기/reads)과 심리전을 통해 LoL의 라인전 메커니즘을 체험으로 배운다.

### 타겟 유저
- LoL에 관심 있지만 진입장벽이 높다고 느끼는 사람
- 챔피언 스킬과 라인전 기본기를 텍스트로 먼저 익히고 싶은 사람
- LoL 경험자 중 의도 싸움/심리전을 즐기고 싶은 사람

### 핵심 경험
1. 자연어로 의도를 입력하면 상대방이 읽고 대응 → **진짜 읽기 싸움**
2. 교전 과정에서 스킬 메커니즘이 자연스럽게 서술 → **플레이하면서 배움**
3. 상대방이 왜 그렇게 대응했는지 설명 → **실전 지식 축적**

---

## 2. 시스템 아키텍처

### LLM 중심 구조
```
클라이언트(상태 보유) → 서버(LLM 호출 + 가드레일) → 클라이언트(상태 업데이트)
```

- **LLM**: 의도 해석 + AI 행동 결정 + 결과 판정 + 상태 업데이트 + 서술
- **서버**: LLM API 호출, JSON 파싱, 범위 검증(가드레일)
- **클라이언트**: 전체 게임 상태 보유, UI 렌더링, 매 턴 서버에 상태 전송

### Stateless 서버
- Vercel Serverless Functions
- 서버는 상태를 저장하지 않음 — 매 턴 클라이언트가 전체 상태 전송
- 서버는 검증 + LLM 호출만 수행

---

## 3. 챔피언 시스템

### 3.1 챔피언 데이터 구조

각 챔피언은 독립된 데이터 파일로 관리:

```
data/champions/
  lee-sin.json
  ahri.json        (향후)
  yasuo.json       (향후)
  ...
```

### 3.2 챔피언 데이터 스키마

```json
{
  "id": "lee-sin",
  "name": "리신",
  "nameEn": "Lee Sin",
  "title": "맹목의 수도승",
  "resource": "energy",
  "resourceMax": 200,
  "baseStats": {
    "hp": 645,
    "hpPerLevel": 108,
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
    "nameEn": "Flurry",
    "description": "스킬 사용 후 다음 2회 기본공격 공격속도 40% 증가 + 기력 회복"
  },
  "skills": {
    "Q": {
      "name": ["음파", "공명타"],
      "nameEn": ["Sonic Wave", "Resonating Strike"],
      "maxRank": 5,
      "cost": [50, 25],
      "cooldown": [10, 9, 8, 7, 6],
      "description": [
        "직선 투사체. 적중 시 물리 피해 + 표식 3초. 미니언에 막힘",
        "표식 대상에게 돌진 + 물리 피해. 대상 잃은 체력에 비례하여 피해 증가 (최대 2배)"
      ]
    },
    "W": {
      "name": ["방호", "철갑"],
      "nameEn": ["Safeguard", "Iron Will"],
      "maxRank": 5,
      "cost": [50, 0],
      "cooldown": [12, 12, 12, 12, 12],
      "description": [
        "아군/미니언에게 돌진 + 쉴드. 자신에게도 사용 가능",
        "생명력 흡수 + 주문 흡혈 증가 4초"
      ]
    },
    "E": {
      "name": ["폭풍", "쇠약"],
      "nameEn": ["Tempest", "Cripple"],
      "maxRank": 5,
      "cost": [50, 0],
      "cooldown": [9, 9, 9, 9, 9],
      "description": [
        "주변 원형 마법 피해 + 표식. 미니언 차단 없음. 총AD 비례",
        "표식 대상 둔화 4초"
      ]
    },
    "R": {
      "name": ["용의 분노"],
      "nameEn": ["Dragon's Rage"],
      "maxRank": 3,
      "unlockLevel": [6, 11, 16],
      "cost": [0],
      "cooldown": [120, 100, 80],
      "description": [
        "대상 넉백 + 강한 물리 피해. 보너스AD 비례. 넉백된 적에 부딪힌 적도 피해"
      ]
    }
  },
  "startItems": {
    "default": {
      "name": "도란의 검",
      "ad": 10,
      "hp": 100,
      "omnivamp": 3.5
    }
  },
  "tips": {
    "combos": [
      "Q1 → AA → AA(패시브) → Q2 (기본 교환, Q만 있으면 가능)",
      "E1 → E2(둔화) → Q1 → Q2 (Q+E 필요, 둔화로 Q1 적중률↑)",
      "Q1 → Q2 → AA → E1 → AA (Q+E 필요, 중간 교전)",
      "Q1 → Q2 → E1 → AA → AA → R (Q+E+R 필요, Lv6 이후 올인)",
      "W1(미니언) → R → Q1 → Q2 (인섹 킥, W+Q+R 필요, Lv6 이후)"
    ],
    "strengths": ["초반 교전 강함", "높은 기동성", "다양한 콤보", "패시브로 기력 관리"],
    "weaknesses": ["후반 약화", "기력 관리 중요", "Q1 빗나가면 올인 불가", "스킬 의존도 높음"]
  }
}
```

### 3.3 LLM 프롬프트에 챔피언 데이터 주입

프롬프트 생성 시 챔피언 데이터를 읽어서 동적으로 삽입:
```
플레이어 챔피언: {champion.name} — {champion.title}
패시브: {champion.passive.description}
Q: {champion.skills.Q.name[0]} — {champion.skills.Q.description[0]}
...
```

챔피언이 바뀌면 프롬프트가 자동으로 바뀜 → 코드 변경 없이 챔피언 추가 가능.

### 3.4 챔피언 추가 절차
1. `data/champions/{id}.json` 작성
2. 셋업 화면 챔피언 선택 UI에 추가
3. 끝 (서버 로직 변경 불필요)

---

## 4. 게임 흐름

### 4.1 셋업
1. 챔피언 선택 (현재: 리신 고정 → 향후: 선택 가능)
2. 소환사 주문 2개 선택 (5개 중 자유 선택)
3. 룬 선택 (정복자 / 감전 / 착취의 손아귀)
4. 게임 시작

### 4.2 라인전
1. 플레이어가 자연어로 의도 입력
2. LLM이 의도 해석 + 상대방 대응 결정 + 결과 판정
3. 서술 + 상대방 코멘트 + 상태 업데이트 + 추천 선택지
4. 레벨업 시 스킬 레벨업 오버레이
5. 반복

### 4.3 승리 조건
- **킬**: 상대 HP 0%
- **CS 50**: 먼저 CS 50 도달
- **타워 파괴**: 상대 타워 체력 0

※ 동시 사망 없음 — 한쪽이 먼저 죽으면 즉시 종료.

### 4.4 게임 종료
- 승패 표시
- 게임 요약 (잘한 점 / 개선점)
- 재시작 버튼
- 복기하기 버튼 (오버레이 닫고 채팅 로그 확인)

---

## 5. 게임 상태

### 5.1 상태 구조
```json
{
  "turn": 1,
  "phase": "play",
  "player": {
    "champion": "lee-sin",
    "hp": 100,
    "maxHp": 100,
    "energy": 200,
    "maxEnergy": 200,
    "level": 1,
    "cs": 0,
    "gold": 0,
    "skillLevels": { "Q": 0, "W": 0, "E": 0, "R": 0 },
    "skillPoints": 1,
    "cooldowns": { "Q": 0, "W": 0, "E": 0, "R": 0 },
    "position": "MID_RANGE",
    "shield": 0,
    "spells": ["flash", "ignite"],
    "spellCooldowns": [0, 0],
    "rune": "conqueror",
    "runeState": {},
    "buffs": [],
    "debuffs": []
  },
  "enemy": { "...same structure..." },
  "minions": {
    "player": { "melee": 3, "ranged": 3 },
    "enemy": { "melee": 3, "ranged": 3 }
  },
  "tower": {
    "player": 100,
    "enemy": 100
  },
  "winner": null
}
```

### 5.2 위치 시스템
그리드 좌표 대신 상황 태그 (거리 단위: 1티모 = 100유닛):
- `MELEE_RANGE` — 근접 (AA, E, R 사거리)
- `MID_RANGE` — 중거리 (Q1 사거리 내)
- `BEHIND_MINIONS` — 미니언 뒤 (Q1 차단됨)
- `BUSH` — 부쉬 (시야 차단)
- `TOWER_RANGE` — 타워 사거리 내
- `FAR` — 멀리 (스킬 사거리 밖)

### 5.3 HP 시스템
- 퍼센트 기반 (0~100%)
- LLM이 스킬 특성 + 현재 상태를 참고하여 피해량 판정
- 서버는 범위만 검증 (0 미만 → 0, 100 초과 → 100)

---

## 6. 턴 시스템

### 의도 단위 턴
- 1턴 = 플레이어의 하나의 "의도"
- 콤보 전체가 1턴에 처리됨 (서술에서 스킬별로 풀어 설명)
- 상대방도 같은 턴에 대응 행동 실행

### 턴 규모 자동 조절
- 양쪽 저강도 (파밍/대기) → 요약 처리
- 한쪽이라도 고강도 (교전/올인) → 세밀하게 처리

### 끼어들기 (Interrupt)
- 플레이어 저강도 + 상대방 고강도 → 턴 중단, 다음 턴에 대응 기회 부여
- "CS를 먹으려는 순간, 상대가 Q1을 날렸다!" 식으로 연출

---

## 7. 상대방 시스템

### 7.1 성격: 친근한 스파링 파트너
- 반말 (~함 체)
- 플레이어 행동에 리액션
- 자기 행동도 자연스럽게 말함
- 스킬 메커니즘을 같이 놀면서 알려줌

### 7.2 행동 원칙
- **플레이어 의도를 읽고 대응** (랜덤이 아님)
- 대응 이유를 설명 → 교육적 가치
- **각 스킬의 고유 효과를 상황에 맞게 활용**하여 행동 → 플레이어가 스킬 효과를 확실히 체험
  - 예: 상대 HP 낮을 때 Q2 사용 → "잃은 체력 비례라 지금 Q2 들어가면 엄청 아픔"
  - 예: W2로 피흡하면서 체력 회복 → "W2 피흡으로 좀 회복함"
  - 예: E2 둔화 걸고 Q1 연계 → "둔화 걸려서 Q1 피하기 어려움"
  - 예: R로 타워 쪽 넉백 → "타워 사거리 안으로 밀어넣기"
  - 예: 패시브 AA로 기력 회복 → "스킬 사이에 AA 넣어야 기력 안 부족함"
- 다양한 스킬 조합 적극 활용 (같은 패턴 반복 X)
- 적당히 공격적 (파밍만 하지 않음)
- 이기는 것보다 **플레이어가 배우는 것**이 목표

### 7.3 챔피언별 상대방 행동
상대방도 선택된 챔피언의 스킬/특성에 맞게 행동:
- 챔피언 데이터의 `tips.combos`를 참고하여 콤보 사용
- 챔피언 `strengths/weaknesses`에 맞는 전략

---

## 8. 소환사 주문 & 룬

### 소환사 주문 (2개 자유 선택)
| 주문 | 효과 |
|------|------|
| 점멸 (Flash) | 즉시 이동, 회피/기습 |
| 점화 (Ignite) | 지속 피해 + 치유 감소 |
| 탈진 (Exhaust) | 둔화 + 피해 35% 감소 |
| 방어막 (Barrier) | 즉시 보호막 |
| 텔레포트 (TP) | 귀환 후 빠른 복귀 |

### 룬 (1개 선택)
| 룬 | 특성 |
|------|------|
| 정복자 (Conqueror) | 장기 교전. 스택 → AD 증가 + 회복 |
| 감전 (Electrocute) | 짧은 교전. 3히트 시 추가 폭딜 |
| 착취의 손아귀 (Grasp) | 지속 체력전. AA 추가 피해 + 회복 + 영구 체력 |

---

## 9. LLM 응답 형식

```json
{
  "narrative": "교전/상황 서술. 스킬 하나하나 설명. 교육적.",
  "aiChat": "상대방 반응 (~함 체). 대응 이유 + 팁.",
  "stateUpdate": {
    "playerHp": 75,
    "enemyHp": 82,
    "playerEnergy": 100,
    "enemyEnergy": 150,
    "playerCooldowns": { "Q": 3, "W": 0, "E": 0, "R": 0 },
    "enemyCooldowns": { "Q": 0, "W": 4, "E": 0, "R": 0 },
    "playerPosition": "MID_RANGE",
    "enemyPosition": "BEHIND_MINIONS",
    "playerCs": 12,
    "enemyCs": 14,
    "playerLevel": 2,
    "enemyLevel": 2,
    "playerGold": 216,
    "enemyGold": 252,
    "playerShield": 0,
    "enemyShield": 0,
    "playerBuffs": [],
    "enemyBuffs": [],
    "playerDebuffs": [],
    "enemyDebuffs": [],
    "playerSpellCooldowns": [0, 0],
    "enemySpellCooldowns": [0, 0],
    "towerHp": { "player": 100, "enemy": 100 },
    "minions": { "player": { "melee": 3, "ranged": 3 }, "enemy": { "melee": 2, "ranged": 3 } }
  },
  "levelUp": null,
  "suggestions": [
    "Q1으로 미니언 사이 빈틈 노려서 견제",
    "W1 쉴드 깔고 앞으로 걸어가서 AA 트레이드",
    "안전하게 뒤에서 CS만 챙기기"
  ],
  "gameOver": null
}
```

---

## 10. UI / UX

### 10.1 셋업 화면
- 챔피언 선택 (향후)
- 소환사 주문 2개 선택
- 룬 1개 선택
- 시작 버튼

### 10.2 게임 화면
- **채팅 영역**: KakaoTalk 스타일
  - 노란 말풍선 = 내 입력
  - 흰 말풍선 = 상대방
  - 서술은 시스템 메시지(카톡 날짜 구분선 형태)로 표시
- **상태바** (항상 표시):
  - 플레이어: HP%, 기력, CS, 레벨, 쿨타임
  - 적: HP%, 기력, CS, 레벨
- **입력**: 텍스트 입력 + 추천 선택지 칩
- **스킬업 오버레이**: 레벨업 시 Q/W/E/R 선택
- **게임오버 오버레이**: 승패 + 요약 + 재시작

### 10.3 플랫폼 제약
- 순수 웹 (HTML/CSS/JS)
- 모바일 반응형
- 미니맵 없음 (순수 텍스트 IF)

---

## 11. 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | 바닐라 HTML/CSS/JS |
| 서버 | Vercel Serverless Functions (Node.js) |
| LLM | Anthropic Claude Sonnet 4.6 API |
| 상태 관리 | Stateless (클라이언트 보유) |
| 배포 | Vercel |
| 소스 관리 | GitHub |

---

## 12. 파일 구조 (V2)

```
ib-lol-talk/
├── src/                      # 프론트엔드
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       └── main.js           # 메인 로직
├── api/                      # Vercel serverless
│   ├── start.js              # 게임 시작
│   ├── turn.js               # 턴 처리
│   └── skillup.js            # 스킬 레벨업
├── server/                   # 서버 로직
│   ├── llm.js                # LLM API 호출
│   ├── prompt.js             # 프롬프트 생성
│   ├── validate.js           # 가드레일 검증
│   └── champions.js          # 챔피언 데이터 로더
├── data/
│   └── champions/
│       └── lee-sin.json      # 리신 데이터
├── docs/
│   ├── PRD.md
│   ├── GAME_DESIGN_V2.md
│   └── LEE_SIN_DATA.md
├── vercel.json
└── package.json
```

---

## 13. 로드맵

### Phase 1: V2 재구성 (현재)
- [ ] LLM 중심 아키텍처 전환
- [ ] 챔피언 데이터 구조 정리 (리신)
- [ ] 프롬프트 재작성
- [ ] 서버 단순화 (가드레일만)
- [ ] 프론트엔드 상태 구조 업데이트
- [ ] E2E 테스트

### Phase 2: 밸런스 & 폴리시
- [ ] LLM 판정 일관성 튜닝
- [ ] AI 행동 다양성 개선
- [ ] UI/UX 개선
- [ ] 모바일 최적화

### Phase 3: 챔피언 확장
- [ ] 챔피언 데이터 스키마 확정
- [ ] 셋업 화면 챔피언 선택 UI
- [ ] 2~3개 챔피언 추가 (예: 아리, 야스오)
- [ ] 비대칭 매치업 (다른 챔피언끼리)

---

## 14. 성공 지표

- 게임 1판 완료율 (시작 → 승패 결정)
- 턴당 평균 응답 시간 (LLM 포함)
- 재시작률 (다시 하기 클릭)
- 스킬 관련 채팅 입력 다양성 (플레이어가 다양한 전략 시도하는지)
