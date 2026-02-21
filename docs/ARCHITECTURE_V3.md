# V3 아키텍처: 하이브리드 (규칙 엔진 + LLM 서술)

## 현재 (V2): LLM이 전부 처리
```
플레이어 입력 → LLM(판정+서술+state+suggestions) → 클라이언트
```
**문제**: 판정 불일관, suggestions 품질 편차, 비용 높음, 밸런스 조정 어려움

## V3: 역할 분리
```
플레이어 입력 → [LLM 1: Intent 해석] → [규칙 엔진: 판정+AI+state] → [LLM 2: 서술] → 클라이언트
```

### 1단계: Intent Parser (LLM, 경량)
- 입력: 자연어 + 사용 가능 스킬 목록
- 출력: 구조화된 intent JSON
```json
{ "type": "combo", "skills": ["Q1", "AA", "Q2"], "intent": "poke_trade" }
{ "type": "farm", "method": "AA", "count": 2 }
{ "type": "move", "position": "미니언뒤" }
{ "type": "spell", "spell": "flash", "purpose": "engage" }
{ "type": "passive", "desc": "대기하면서 관찰" }
```
- **토큰**: ~200 input, ~50 output (현재 대비 ~80% 절감)

### 2단계: 규칙 엔진 (서버, LLM 없음)

#### 2a. 적중 판정
위치 × 스킬 특성 매트릭스:
```
             근접   중거리   미니언뒤   수풀   타워사거리   원거리
AA           ✓      ✗       ✗         ✗      ✓           ✗
Q1(투사체)   ✓      ✓       ✗(차단)   ✗      ✓           ✗
Q2(돌진)     ✓      ✓       ✓         ✓      ✓           ✓  (표식 있으면 무조건)
W1(돌진)     ✓      ✓       ✓         ✓      ✓           ✗
E1(범위)     ✓      ✗       ✗         ✗      ✓           ✗
R(대상지정)  ✓      ✗       ✗         ✗      ✓           ✗
```

#### 2b. 데미지 계산
- HP% 기반 (V2 유지)
- 스킬 레벨별 기본 데미지 → HP% 변환 테이블
- 리신 기준: Q1 Lv1 = ~7%, Lv5 = ~12% (레벨/아이템 보정)
- Q2: 기본 + 잃은체력비례 (최대 2배)
- 쉴드 우선 차감

#### 2c. AI 행동 결정
상황 태그 → 가중치 기반 선택:
```json
{
  "hp_high_energy_high": { "trade": 40, "farm": 30, "poke": 25, "all_in": 5 },
  "hp_low_energy_low": { "retreat": 50, "farm_safe": 30, "shield": 15, "desperation": 5 },
  "enemy_skill_on_cd": { "aggressive_trade": 50, "poke": 30, "farm": 20 },
  "level_advantage": { "all_in": 35, "trade": 35, "poke": 20, "farm": 10 }
}
```

#### 2d. Suggestions 생성 (규칙 기반)
상황 분석 → 카테고리 선택 → 템플릿 채우기:
```json
{
  "aggressive": [
    "상대 {skill} 쿨타임이니 {my_skill}로 교환",
    "미니언 수 우위, 앞으로 압박하며 {my_skill} 노리기",
    "상대 HP {enemy_hp}%로 낮으니 올인 타이밍"
  ],
  "defensive": [
    "미니언 뒤에서 안전하게 CS 챙기기",
    "HP 회복 위해 W2 피흡 활용",
    "상대 {enemy_skill} 사거리 밖에서 CS"
  ],
  "utility": [
    "수풀에서 시야 끊고 상대 긴장시키기",
    "미니언 정리하고 리콜 타이밍 만들기"
  ]
}
```

### 3단계: Narrator (LLM, 경량)
- 입력: 이벤트 로그 (구조화)
- 출력: narrative + aiChat
```
입력:
  events: [
    { actor: "player", action: "Q1", result: "hit", damage: 8 },
    { actor: "player", action: "Q2", result: "hit", damage: 14 },
    { actor: "enemy", action: "E1", result: "hit", damage: 6 },
    { actor: "enemy", action: "retreat", position: "중거리" }
  ]
  context: { playerHp: 78, enemyHp: 62, turn: 5 }

출력:
  { "narrative": "Q1 적중 후 Q2로 돌진. 상대 E1으로 맞교환했지만 큰 손해를 입고 뒤로 물러남.",
    "aiChat": "아 Q 맞고 따라오는 건 좀 아팠음. E로 맞교환은 했는데 손해봤음" }
```
- **토큰**: ~300 input, ~100 output

### 비용 비교 (Sonnet 4.6 기준, 턴당)
| 항목 | V2 | V3 |
|------|----|----|
| LLM 호출 | 1회 (무거움) | 2회 (경량) |
| Input 토큰 | ~2000 | ~500 (250+250) |
| Output 토큰 | ~300 | ~150 (50+100) |
| Input 비용 | $0.006 | $0.0015 |
| Output 비용 | $0.0045 | $0.00225 |
| **턴당 합계** | **~$0.01** | **~$0.004** |
| **60% 절감** | | ✅ |

### 파일 구조
```
server/
  intent.js       — LLM intent parser (경량 프롬프트)
  combat.js       — 적중 판정 + 데미지 계산
  ai.js           — AI 행동 결정 (가중치 기반)
  suggest.js      — 규칙 기반 suggestions
  narrator.js     — LLM 서술 생성 (경량 프롬프트)
  validate.js     — 가드레일 (기존 유지)
  champions.js    — JSON 로더 (기존 유지)
data/
  champions/lee-sin.json  — 스킬 데이터 + 전투 속성 추가
  rules/
    hit-matrix.json       — 위치×스킬 적중 매트릭스
    damage-table.json     — 레벨별 HP% 데미지 테이블
    ai-weights.json       — AI 행동 가중치
    suggestions.json      — 상황별 suggestion 템플릿
```

### 구현 순서
1. **데이터 설계**: hit-matrix, damage-table, ai-weights, suggestions 템플릿
2. **combat.js**: 적중 판정 + 데미지 계산
3. **ai.js**: AI 행동 결정
4. **suggest.js**: 규칙 기반 suggestions
5. **intent.js**: LLM intent parser
6. **narrator.js**: LLM 서술 생성
7. **api/turn.js 리팩토링**: V3 파이프라인 연결
8. **테스트 + 밸런스 조정**
