// V3 Intent Parser — LLM 경량 호출
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/**
 * parseIntent(input, gameState) → intent JSON
 * 경량 LLM: max_tokens 100
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
  const spells = p.spells.filter((s, i) => (p.spellCooldowns?.[i] || 0) === 0);

  const systemPrompt = `리신 1v1 라인전. 플레이어 입력→intent JSON 변환.
사용가능: ${available.join(', ') || '없음'} | 소환사: ${spells.join(', ') || '없음'} | 위치: ${p.position} | 기력: ${p.energy}
스킬표기: Q1(음파)/Q2(공명타)/W1(방호)/W2(철갑)/E1(폭풍)/E2(쇠약)/R(용의분노). AA=기본공격
JSON만 출력. 형식:
{"type":"skill|combo|farm|move|spell|passive|recall","skill":"Q1","skills":["Q1","AA","Q2"],"position":"위치태그","spell":"flash","count":1,"desc":"설명"}
type=combo면 skills 배열 필수. type=skill이면 skill 하나.`;

  try {
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: input }],
    });

    const text = response.content[0].text.trim();
    const parsed = extractJSON(text);
    if (parsed && parsed.type) return parsed;
  } catch (err) {
    console.error('Intent parse error:', err.message);
  }

  // Fallback: 키워드 기반
  return fallbackParse(input, p);
}

function fallbackParse(input, player) {
  const lower = input.toLowerCase();
  
  if (/q.*q|음파.*공명|콤보/.test(lower) && player.skillLevels.Q > 0) {
    return { type: 'combo', skills: ['Q1', 'AA', 'Q2'], intent: 'trade' };
  }
  if (/올인|풀콤/.test(lower)) {
    const skills = [];
    if (player.skillLevels.Q > 0) skills.push('Q1', 'Q2');
    if (player.skillLevels.E > 0) skills.push('E1');
    if (player.skillLevels.R > 0) skills.push('R');
    return { type: 'combo', skills: skills.length ? skills : ['AA'], intent: 'all_in' };
  }
  if (/q1|음파/.test(lower)) return { type: 'skill', skill: 'Q1' };
  if (/q2|공명/.test(lower)) return { type: 'skill', skill: 'Q2' };
  if (/w1|방호|쉴드/.test(lower)) return { type: 'skill', skill: 'W1' };
  if (/w2|철갑|피흡/.test(lower)) return { type: 'skill', skill: 'W2' };
  if (/e1|폭풍/.test(lower)) return { type: 'skill', skill: 'E1' };
  if (/e2|쇠약|둔화/.test(lower)) return { type: 'skill', skill: 'E2' };
  if (/r|궁|용의/.test(lower)) return { type: 'skill', skill: 'R' };
  if (/cs|파밍|막타/.test(lower)) return { type: 'farm', method: 'AA', count: 2 };
  if (/수풀|부쉬/.test(lower)) return { type: 'move', position: '수풀' };
  if (/후퇴|뒤로|도망/.test(lower)) return { type: 'move', position: '타워사거리' };
  if (/접근|앞으로/.test(lower)) return { type: 'move', position: '근접' };
  if (/리콜|귀환/.test(lower)) return { type: 'recall' };
  if (/점멸|플래시|flash/.test(lower)) return { type: 'spell', spell: 'flash', purpose: 'engage' };
  if (/점화|이그/.test(lower)) return { type: 'spell', spell: 'ignite' };
  
  return { type: 'passive', desc: input };
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}
