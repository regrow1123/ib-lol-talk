// AI opponent logic — weight-based action selection

export function chooseAction(actions, aiState, playerState) {
  if (actions.length === 0) return null;

  const weights = actions.map(action => {
    let w = 1;
    const hpRatio = aiState.hp / aiState.maxHp;
    const playerHpRatio = playerState.hp / playerState.maxHp;

    // Aggressive when HP is high
    if (action.type === 'attack') {
      w += hpRatio > 0.6 ? 3 : 1;
      // More aggressive when player is low
      if (playerHpRatio < 0.4) w += 4;
      // Prefer center aim (easy pattern for easy AI)
      if (action.direction === 'center') w += 2;
      // Q2 follow-up always good
      if (action.skill === 'Q2') w += 5;
      // E2 follow-up
      if (action.skill === 'E2') w += 3;
    }

    // CS when available and safe
    if (action.type === 'cs') {
      w += 3;
      if (action.id === 'CS') w += 2; // actual last hit
      // Less CS when low HP
      if (hpRatio < 0.3) w -= 2;
    }

    // Defensive when low HP
    if (action.type === 'defense') {
      if (hpRatio < 0.5) w += 4;
      if (hpRatio < 0.3) w += 3;
      if (action.skill === 'POTION' && hpRatio < 0.6) w += 3;
    }

    // Movement
    if (action.type === 'move') {
      if (action.direction === 'back' && hpRatio < 0.3) w += 5;
      // bush removed
      // Some randomness through position preference
      if (action.direction === 'left' || action.direction === 'right') w += 1;
    }

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
