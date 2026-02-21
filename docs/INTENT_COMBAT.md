# 의도 기반 전투 시스템 V2 (Intent Combat System)

## 핵심 철학
1. **의도 조합이 결과를 100% 결정** — 확률/운 요소 없음
2. **AI는 읽을 수 있는 패턴을 가짐** — 플레이어가 학습하고 예측
3. **복합 의도** — 주행동 + 부행동으로 자연어 풍부함 유지

## 의도 구조

### 주행동 (main) — 이번 턴의 핵심 행동
| 의도 | 설명 |
|------|------|
| **all_in** | 올인 콤보 (최대 피해, 최대 리스크) |
| **trade** | 짧은 교환 (적당한 피해, 적당한 리스크) |
| **poke** | 안전거리 견제 (낮은 피해, 낮은 리스크) |
| **dodge** | 회피/후퇴에 집중 |
| **farm** | CS 먹기에 집중 |
| **defend** | 쉴드/방어에 집중 |

### 부행동 (sub) — 동시에 하는 보조 행동 (optional)
| 부행동 | 설명 |
|--------|------|
| **poke_ready** | CS/대기 중이지만 기회 있으면 견제 |
| **dodge_ready** | 공격하면서도 회피 준비 |
| **farm_side** | 공격/방어하면서 CS도 챙기기 |
| **bait** | 일부러 빈틈 보여서 상대 유인 |
| **zone** | 위치 압박으로 상대 행동 제한 |
| null | 주행동에만 집중 |

### 예시
```json
{ "main": "farm", "sub": "poke_ready", "skills": ["AA"] }
→ "CS 먹으면서 상대 앞에 오면 Q1 노리기"

{ "main": "trade", "sub": "dodge_ready", "skills": ["Q1", "AA", "Q2"] }
→ "Q 교환 하되 상대 반격은 피할 준비"

{ "main": "poke", "sub": "bait", "skills": ["Q1"] }
→ "Q1 견제하면서 올인 유도"
```

## 의도 × 의도 매트릭스 (100% 결정적, 확률 없음)

결과 코드:
- `TRADE` — 양쪽 100% 데미지
- `P_HIT` — 플레이어만 적중 100%
- `E_HIT` — 적만 적중 100%
- `P_ADV` — 플레이어 100%, 적 50% (유리한 교환)
- `E_ADV` — 적 100%, 플레이어 50%
- `PUNISH` — 한쪽 120% (무방비 상태)
- `SHIELD` — 50% 경감
- `MISS` — 양쪽 0%, 소강
- `BAIT_SUCCESS` — 미끼 성공, 반전

### 메인 매트릭스 (main × main)
```
              적:all_in   적:trade   적:poke   적:dodge   적:farm    적:defend
나:all_in      TRADE       P_ADV      P_ADV     P_HIT      PUNISH(P)  SHIELD
나:trade       E_ADV       TRADE      P_ADV     MISS       P_HIT      SHIELD
나:poke        E_ADV       E_ADV      TRADE     MISS       P_HIT      MISS
나:dodge       E_HIT       MISS       MISS      MISS       MISS       MISS
나:farm        PUNISH(E)   E_HIT      E_HIT     MISS       FARM_BOTH  MISS
나:defend      SHIELD      SHIELD     MISS      MISS       MISS       MISS
```

### 부행동 보정 (sub가 결과를 수정)

#### dodge_ready (회피 준비)
- 상대 공격에 맞을 때 → 데미지 70%로 경감 (100% → 70%)
- 내가 PUNISH 당할 때 → PUNISH 취소, 일반 HIT으로 변경

#### poke_ready (견제 대기)
- 내가 farm이고 상대가 farm/dodge일 때 → P_HIT 발동 (기회 포착)
- 나머지 상황에서는 효과 없음

#### bait (유인)
- 상대가 all_in/trade로 달려들면 → BAIT_SUCCESS
  - 내가 dodge+반격 → P_ADV (상대가 속아서 들어왔고 내가 카운터)
- 상대가 안 물면 → 시간 낭비 (MISS)

#### farm_side (틈새 CS)
- 전투 중에도 CS 1~2개 추가 획득
- 데미지에는 영향 없음

#### zone (위치 압박)
- 상대가 farm이면 → CS 획득량 감소 (상대 CS 0)
- 상대가 dodge이면 → 상대 위치 원거리로 밀림

## AI 성격 시스템 (읽기 가능한 패턴)

### 3가지 AI 성격
```json
{
  "aggressive": {
    "name": "호전적",
    "description": "HP 우위면 무조건 들어감, 킬각 보이면 올인",
    "tendencies": {
      "hp_advantage": { "all_in": 45, "trade": 35, "poke": 15, "farm": 5 },
      "hp_even": { "trade": 40, "poke": 30, "farm": 20, "all_in": 10 },
      "hp_disadvantage": { "trade": 30, "poke": 25, "defend": 25, "farm": 15, "dodge": 5 },
      "kill_range": { "all_in": 70, "trade": 20, "poke": 10 }
    },
    "readable_tells": [
      "HP 우위에서 거의 항상 trade/all_in",
      "HP 불리해도 쉽게 물러나지 않음",
      "킬각이면 무조건 올인"
    ]
  },
  "calculated": {
    "name": "계산적",
    "description": "쿨타임/기력 계산하고, 유리할 때만 교환",
    "tendencies": {
      "skills_ready": { "trade": 40, "poke": 30, "all_in": 20, "farm": 10 },
      "skills_on_cd": { "farm": 45, "defend": 30, "dodge": 20, "poke": 5 },
      "energy_low": { "farm": 50, "defend": 30, "dodge": 20 },
      "level_advantage": { "all_in": 35, "trade": 35, "poke": 20, "farm": 10 }
    },
    "readable_tells": [
      "스킬 쿨타임이면 절대 싸우지 않음",
      "기력 없으면 무조건 수비",
      "유리할 때만 공격적"
    ]
  },
  "reactive": {
    "name": "반응형",
    "description": "상대 행동에 맞춰 카운터, 먼저 공격 안 함",
    "tendencies": {
      "player_aggressive": { "dodge": 30, "defend": 30, "trade": 25, "poke": 15 },
      "player_passive": { "poke": 35, "trade": 30, "farm": 25, "all_in": 10 },
      "player_farming": { "poke": 40, "trade": 30, "farm": 20, "all_in": 10 },
      "default": { "farm": 35, "poke": 30, "defend": 20, "trade": 15 }
    },
    "readable_tells": [
      "플레이어가 공격하면 방어/회피 위주",
      "플레이어가 수동적이면 견제 늘림",
      "먼저 올인하는 경우가 거의 없음"
    ]
  }
}
```

### AI 성격은 게임 시작 시 랜덤 배정 (but 읽을 수 있음)
- 플레이어가 3~5턴 플레이하면 패턴 파악 가능
- "아 이 상대는 HP 우위면 무조건 들어오는 타입이구나" → 카운터 가능
- **이것이 심리전의 핵심** — 상대를 읽고 카운터하기

## 데미지 계산 (기존 damage-table.json 활용)

1. 의도에 포함된 스킬별 HP% 데미지 합산
2. 매트릭스 결과 코드별 배율 적용:
   - TRADE: 100%
   - P_ADV/E_ADV: 유리 100%, 불리 50%
   - PUNISH: 120%
   - SHIELD: 50%
   - MISS: 0%
   - P_HIT/E_HIT: 적중 100%, 미적중 0%
   - BAIT_SUCCESS: 카운터 쪽 120%, 속은 쪽 50%

## 위치 업데이트 (의도의 결과)

| 의도 | 결과 위치 |
|------|----------|
| all_in | → 근접 |
| trade | → 근접 → 중거리 (빠지기) |
| poke | → 중거리 유지 |
| dodge | → 중거리 or 원거리 |
| farm | → 미니언뒤 |
| defend | → 현재 유지 |
