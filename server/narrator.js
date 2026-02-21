// V3 Narrator — LLM 서술 생성 (경량)
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/**
 * narrate(events, gameState) → { narrative, aiChat }
 * max_tokens: 200
 */
export async function narrate(events, gameState) {
  const p = gameState.player, e = gameState.enemy;

  const eventLog = events.map(ev => {
    const who = ev.actor === 'player' ? '플레이어' : '상대';
    if (ev.result === 'hit') return `${who} ${ev.action} 적중 (${ev.damage}% 피해)`;
    if (ev.result === 'miss') return `${who} ${ev.action} 빗나감 (${ev.reason || ''})`;
    if (ev.result === 'shield') return `${who} ${ev.action} 쉴드 ${ev.shieldAmount}%`;
    if (ev.result === 'slow') return `${who} ${ev.action} 둔화 ${ev.slowAmount}%`;
    if (ev.result === 'cooldown') return `${who} ${ev.action} 쿨타임`;
    if (ev.result === 'no_energy') return `${who} ${ev.action} 기력부족`;
    if (ev.result === 'unavailable') return `${who} ${ev.action} 미습득`;
    if (ev.action === 'farm') return `${who} CS ${ev.csGain}개 획득`;
    if (ev.action === 'move') return `${who} ${ev.position}으로 이동`;
    if (ev.action === 'passive') return `${who} 대기`;
    if (ev.action === 'recall') return `${who} 리콜`;
    return `${who} ${ev.action} ${ev.result}`;
  }).join('. ');

  const systemPrompt = `LoL 리신 1v1 라인전 서술자. 이벤트 로그→narrative+aiChat 생성.
규칙:
- narrative: 1~2문장, 간결, ~함/~했다 체
- aiChat: 상대방 반말. ~했음/~됐음/~인듯/~ㅋㅋ 종결. "체" 글자 금지. "AI" 금지→"상대방"도 안 씀, 그냥 1인칭. 친근+대응이유+팁
- JSON만: {"narrative":"...","aiChat":"..."}`;

  const userPrompt = `이벤트: ${eventLog}
상태: 플HP${p.hp}% 적HP${e.hp}% 턴${gameState.turn} 플위치:${p.position} 적위치:${e.position}`;

  try {
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text.trim();
    const parsed = extractJSON(text);
    if (parsed?.narrative) return parsed;
  } catch (err) {
    console.error('Narrator error:', err.message);
  }

  // Fallback
  return fallbackNarrate(events);
}

function fallbackNarrate(events) {
  const parts = [];
  const aiParts = [];

  for (const ev of events) {
    if (ev.actor === 'player' || ev.actor === 'attacker') {
      if (ev.result === 'hit') {
        parts.push(`${ev.action}이 적중해 ${ev.damage}% 피해를 입혔다.`);
        aiParts.push(`${ev.action} 맞았음`);
      } else if (ev.result === 'miss') {
        parts.push(`${ev.action}이 빗나갔다.`);
        aiParts.push('잘 피했음 ㅋㅋ');
      } else if (ev.result === 'shield') {
        parts.push(`쉴드를 올렸다.`);
      } else if (ev.action === 'farm') {
        parts.push(`CS를 챙겼다.`);
        aiParts.push('파밍하는 거 보임');
      }
    } else {
      if (ev.result === 'hit') {
        parts.push(`상대의 ${ev.action}에 ${ev.damage}% 피해를 입었다.`);
        aiParts.push(`${ev.action}으로 한 대 넣었음`);
      }
    }
  }

  return {
    narrative: parts.join(' ') || '양쪽 모두 조심스럽게 거리를 재고 있다.',
    aiChat: aiParts.join('. ') || '별 일 없었음',
  };
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}
