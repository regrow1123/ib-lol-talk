// Guardrail validation — clamp values to valid ranges

export function validateState(state) {
  clampFighter(state.player);
  clampFighter(state.enemy);

  // Distance
  state.distance = Math.max(0, state.distance || 0);

  // CS/level never decrease (handled by engine, but double-check)
  return state;
}

function clampFighter(f) {
  f.hp = Math.max(0, Math.min(f.maxHp, Math.round(f.hp)));
  f.resource = Math.max(0, Math.min(f.maxResource, Math.round(f.resource)));
  f.shield = Math.max(0, Math.round(f.shield));

  for (const key of Object.keys(f.cooldowns)) {
    f.cooldowns[key] = Math.max(0, f.cooldowns[key]);
  }
  for (let i = 0; i < f.spellCooldowns.length; i++) {
    f.spellCooldowns[i] = Math.max(0, f.spellCooldowns[i]);
  }
}
