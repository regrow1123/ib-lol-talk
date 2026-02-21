// V3 Intent Parser — LLM이 main + sub + skills 파싱
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/**
 * parseIntent(input, gameState) → { main, sub, skills }
 */
export async function parseIntent(input, gameState) {
  const p = gameState.player;

  // 사용 가능 스킬 목록
  const available = [];
  for (const k of ['Q', 'W', 'E', 'R']) {
    if (p.skillLevels[k] > 0 && p.cooldowns[k] === 0) {
      const cost = { Q: 50, W: 50, E: 50, R: 0 }[k];
      if (p.energy >= cost) available.push(`${k}(Lv${p.skillLevels[k]})`);
    }
  }

  const systemPrompt = `리신 1v1 라인전. 플레이어 자연어 입력→의도(intent) JSON 변환.

## 주행동 (main) — 이번 턴의 핵심 행동
- all_in: 올인 콤보 (최대 피해, 최대 리스크)
- trade: 짧은 교환 (적당한 피해/리스크)
- poke: 안전거리 견제 (낮은 피해/리스크)
- dodge: 회피/후퇴에 집중
- farm: CS 먹기에 집중
- defend: 쉴드/방어에 집중

## 부행동 (sub) — 동시에 하는 보조 행동 (optional, null 가능)
- poke_ready: CS/대기 중이지만 기회 있으면 견제
- dodge_ready: 공격하면서도 회피 준비
- farm_side: 공격/방어하면서 CS도 챙기기
- bait: 일부러 빈틈 보여서 상대 유인
- zone: 위치 압박으로 상대 행동 제한

## skills — 사용할 스킬 배열
스킬표기: Q1(음파)/Q2(공명타)/W1(방호)/W2(철갑)/E1(폭풍)/E2(쇠약)/R(용의분노)/AA(기본공격)
사용가능: ${available.join(', ') || '없음'} | 위치: ${p.position} | 기력: ${p.energy}

JSON만 출력:
{"main":"trade","sub":"dodge_ready","skills":["Q1","AA","Q2"]}`;

  try {
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: input }],
    });

    const text = response.content[0].text.trim();
    const parsed = extractJSON(text);
    if (parsed && parsed.main) return normalizeIntent(parsed, p);
  } catch (err) {
    console.error('Intent parse error:', err.message);
  }

  // Fallback: 키워드 기반
  return fallbackParse(input, p);
}

function normalizeIntent(parsed, player) {
  const validMains = ['all_in', 'trade', 'poke', 'dodge', 'farm', 'defend'];
  const validSubs = ['dodge_ready', 'poke_ready', 'bait', 'farm_side', 'zone', null];

  const main = validMains.includes(parsed.main) ? parsed.main : 'farm';
  const sub = validSubs.includes(parsed.sub) ? parsed.sub : null;
  const skills = Array.isArray(parsed.skills) ? parsed.skills : ['AA'];

  return { main, sub, skills };
}

function fallbackParse(input, player) {
  const lower = input.toLowerCase();

  // main 판별
  let main = 'farm';
  let sub = null;
  let skills = ['AA'];

  if (/올인|풀콤|죽여|킬/.test(lower)) {
    main = 'all_in';
    skills = [];
    if (player.skillLevels.Q > 0 && player.cooldowns.Q === 0) skills.push('Q1', 'Q2');
    if (player.skillLevels.E > 0 && player.cooldowns.E === 0) skills.push('E1');
    if (player.skillLevels.R > 0 && player.cooldowns.R === 0) skills.push('R');
    skills.push('AA');
  } else if (/교환|트레이드|q.*q|음파.*공명/.test(lower)) {
    main = 'trade';
    skills = [];
    if (player.skillLevels.Q > 0 && player.cooldowns.Q === 0) skills.push('Q1', 'AA', 'Q2');
    else skills.push('AA');
  } else if (/견제|찔|q1|음파|포크/.test(lower)) {
    main = 'poke';
    skills = player.skillLevels.Q > 0 && player.cooldowns.Q === 0 ? ['Q1'] : ['AA'];
  } else if (/회피|피하|dodge|후퇴|뒤로|도망/.test(lower)) {
    main = 'dodge';
    skills = player.skillLevels.W > 0 && player.cooldowns.W === 0 ? ['W1'] : [];
  } else if (/cs|파밍|막타|미니언/.test(lower)) {
    main = 'farm';
    skills = ['AA'];
  } else if (/방어|쉴드|w1|방호|defend/.test(lower)) {
    main = 'defend';
    skills = player.skillLevels.W > 0 && player.cooldowns.W === 0 ? ['W1'] : [];
  }

  // sub 판별
  if (/회피.*준비|피할.*준비|dodge.*ready|조심/.test(lower)) sub = 'dodge_ready';
  else if (/기회.*견제|poke.*ready|노리/.test(lower)) sub = 'poke_ready';
  else if (/유인|미끼|bait/.test(lower)) sub = 'bait';
  else if (/cs.*챙|farm.*side|틈새/.test(lower)) sub = 'farm_side';
  else if (/압박|zone|밀어/.test(lower)) sub = 'zone';

  return { main, sub, skills };
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}
