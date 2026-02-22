export function validateState(state) {
  for (const side of ['player', 'enemy']) {
    const f = state[side];
    f.hp = Math.round(Math.max(0, Math.min(f.hp, f.maxHp)));
    f.resource = Math.round(Math.max(0, Math.min(f.resource, f.maxResource)));
    for (const key of Object.keys(f.cooldowns)) {
      if (f.cooldowns[key] < 0) f.cooldowns[key] = 0;
    }
    for (let i = 0; i < f.spellCooldowns.length; i++) {
      if (f.spellCooldowns[i] < 0) f.spellCooldowns[i] = 0;
    }
  }
  if (state.distance < 0) state.distance = 0;
  return state;
}
