// AI opponent logic — weight-based intent selection

export function chooseAction(actions, aiState, playerState) {
  if (actions.length === 0) return null;

  const weights = actions.map(action => {
    let w = 1;
    const hpRatio = aiState.hp / aiState.maxHp;
    const playerHpRatio = playerState.hp / playerState.maxHp;
    const intent = action.intent;

    // Aggressive intents when HP is high
    if (action.type === 'attack') {
      w += hpRatio > 0.6 ? 3 : 1;
      // More aggressive when player is low
      if (playerHpRatio < 0.4) w += 4;
      
      // Specific attack preferences
      if (intent === 'Q2_CAST') w += 5; // Always follow up Q2
      if (intent === 'E2_CAST') w += 3; // Follow up E2
      if (intent === 'AA_CHAMP') w += 2; // Basic attacks are reliable
      if (intent === 'R_CAST' && playerHpRatio < 0.5) w += 4; // R when enemy low
    }

    // CS priority when available and safe
    if (action.type === 'cs') {
      w += 3;
      if (intent === 'CS_SAFE') w += 2; // Prefer safe CS
      if (intent === 'CS_PUSH' && hpRatio > 0.7) w += 2; // Aggressive CS when healthy
      // Less CS when low HP
      if (hpRatio < 0.3) w -= 2;
    }

    // Defensive intents when low HP
    if (action.type === 'defense' || action.type === 'utility') {
      if (hpRatio < 0.5) w += 4;
      if (hpRatio < 0.3) w += 3;
      if (intent === 'POTION' && hpRatio < 0.6) w += 5;
      if (intent === 'W1_SELF' && hpRatio < 0.4) w += 3;
      if (intent === 'RECALL' && hpRatio < 0.2) w += 6; // Recall when very low
    }

    // Positioning intents
    if (action.type === 'positioning') {
      if (intent === 'RETREAT' && hpRatio < 0.3) w += 5; // Retreat when low
      if (intent === 'PRESS' && hpRatio > 0.6 && playerHpRatio < 0.5) w += 4; // Press advantage
      if (intent === 'ALL_IN' && playerHpRatio < 0.3 && hpRatio > 0.4) w += 6; // All in for kill
      if (intent === 'MV_DODGE') w += 2; // Always decent to dodge
      if (intent === 'BUSH_IN' && hpRatio < 0.4) w += 3; // Hide when low
      if (intent === 'BUSH_OUT' && hpRatio > 0.7) w += 2; // Come out when healthy
    }

    // Energy management
    if (aiState.energy < 50 && (action.type === 'attack' && intent !== 'AA_CHAMP')) {
      w *= 0.3; // Avoid energy-hungry attacks when low
    }

    // Avoid dangerous intents when low HP
    if (hpRatio < 0.3) {
      if (['PRESS', 'ALL_IN', 'CS_PUSH'].includes(intent)) {
        w *= 0.4; // Much less likely to be aggressive
      }
    }

    // Prefer follow-up abilities
    if (intent === 'Q2_CAST' && aiState.q1Hit) w += 8;
    if (intent === 'E2_CAST' && aiState.e1Hit) w += 6;
    if (intent === 'W2_CAST' && aiState.w1Used) w += 4;

    // Some randomness based on turn number to vary AI behavior
    const turnVariation = (aiState.turn || 0) % 7;
    if (turnVariation === 0 && intent === 'PRESS') w += 1;
    if (turnVariation === 1 && intent === 'CS_SAFE') w += 1;
    if (turnVariation === 2 && intent === 'MV_DODGE') w += 1;

    return Math.max(0.1, w);
  });

  // Weighted random selection
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < actions.length; i++) {
    r -= weights[i];
    if (r <= 0) return actions[i];
  }
  return actions[actions.length - 1];
}