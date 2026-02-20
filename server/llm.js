// LLM integration — Anthropic Claude API
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';

const client = new Anthropic();  // uses ANTHROPIC_API_KEY env var

export async function interpretTurn(game, playerInput) {
  const systemPrompt = buildSystemPrompt(game);

  const response = await client.messages.create({
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      { role: 'user', content: playerInput },
    ],
  });

  const text = response.content[0].text.trim();

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('LLM JSON parse error:', e.message);
    console.error('Raw response:', text);
    // Fallback: safe default
    return {
      playerAction: { type: 'IDLE', detail: '입력을 해석할 수 없었습니다' },
      aiAction: { type: 'CS_SAFE', detail: '미니언 뒤에서 CS를 챙긴다' },
      resolution: {
        playerHits: [],
        aiHits: [],
        playerCs: 0,
        aiCs: 1,
        positionChange: { player: { x: 0, y: 0 }, enemy: { x: 0, y: 0 } },
        interrupted: false,
        turnScale: 'farming',
      },
      narrative: '잠시 소강 상태... 양쪽 모두 조심스럽게 움직인다.',
      aiChat: null,
    };
  }
}
