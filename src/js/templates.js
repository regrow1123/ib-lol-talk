// Natural language choice/result templates in Korean

// Direction labels
const DIR = {
  center: '제자리', left: '왼쪽', right: '오른쪽', back: '뒤쪽', forward: '앞쪽', bush: '부쉬'
};

const DIR_PREDICTION = {
  center: 'CS를 포기 못할 거라 보고',
  left: '왼쪽으로 빠질 것 같아서',
  right: '오른쪽으로 빠질 것 같아서',
  back: '뒤로 물러날 걸 예상하고',
  forward: '앞으로 덤빌 것 같아서',
};

// Choice templates
export function getAttackChoiceText(skill, direction) {
  const pred = DIR_PREDICTION[direction];
  const skillNames = {
    Q1: 'Q를 날린다',
    E1: 'E - 폭풍을 내리친다',
    AA: '기본공격을 날린다',
    R: 'R - 용의 분노를 날린다',
  };

  if (skill === 'Q1') {
    return `적이 ${pred}, ${DIR[direction]}을 겨냥해 음파(Q)를 날린다`;
  }
  if (skill === 'E1') {
    return `적이 가까이 있을 때, 폭풍(E)으로 주변을 강타한다`;
  }
  if (skill === 'AA') {
    return `적이 ${pred}, ${DIR[direction]}을 겨냥해 기본공격을 날린다`;
  }
  if (skill === 'R') {
    return `적에게 용의 분노(R)를 날려 뒤로 밀어낸다`;
  }
  return `${skillNames[skill] || skill}`;
}

export function getCSChoiceText(hasMinion) {
  if (hasMinion) {
    return '체력이 낮은 미니언을 기본공격으로 마무리한다';
  }
  return '미니언 웨이브를 정리하며 자리를 지킨다';
}

export function getMoveChoiceText(direction) {
  const texts = {
    left: '적의 공격이 올 것 같아 왼쪽으로 몸을 뺀다',
    right: '적의 공격이 올 것 같아 오른쪽으로 몸을 뺀다',
    back: '위험을 느끼고 뒤쪽으로 물러선다',
    forward: '대담하게 앞으로 걸어가며 압박을 건다',
    bush: '부쉬 쪽으로 이동해 시야를 끊는다',
  };
  return texts[direction] || `${DIR[direction]}으로 이동한다`;
}

export function getDefenseChoiceText(type) {
  if (type === 'W1') return '방호(W)를 사용해 자신에게 쉴드를 건다';
  if (type === 'POTION') return '체력 포션을 마셔 체력을 회복한다';
  return '방어 태세를 취한다';
}

export function getQ2ChoiceText() {
  return '음파가 적중한 적에게 공명타(Q2)로 돌진한다';
}

export function getW2ChoiceText() {
  return '철갑(W2)으로 생명력 흡수 효과를 얻는다';
}

export function getE2ChoiceText() {
  return '쇠약(E2)으로 적의 이동속도를 둔화시킨다';
}

// Result narrative templates
export function getHitNarrative(attackerName, skill, damage, targetName) {
  const skillText = {
    Q1: '음파가', E1: '폭풍이', AA: '기본공격이', R: '용의 분노가', Q2: '공명타가'
  };
  return `${attackerName}의 ${skillText[skill] || skill} ${targetName}에게 적중! ${Math.round(damage)} 피해`;
}

export function getMissNarrative(attackerName, skill, reason) {
  const skillText = {
    Q1: '음파가', E1: '폭풍이', AA: '기본공격이', R: '용의 분노가'
  };
  const reasons = {
    dodge: '빗나갔다!',
    bush: '부쉬에 숨은 적을 찾지 못했다!',
    range: '사거리 밖이다!',
  };
  return `${attackerName}의 ${skillText[skill] || skill} ${reasons[reason] || '빗나갔다!'}`;
}

export function getCSNarrative(name, gold) {
  return `${name}이(가) 미니언을 처치했다! (+${gold}G)`;
}

export function getShieldNarrative(name, amount) {
  return `${name}이(가) 방호(W)로 ${Math.round(amount)}의 쉴드를 얻었다`;
}

export function getMoveNarrative(name, direction) {
  return `${name}이(가) ${DIR[direction]}으로 이동했다`;
}

export function getTurnSituation(turn, playerPos, enemyPos, minionInfo, player, enemy) {
  const lines = [];
  const posName = ['아군타워', '아군쪽', '중앙', '적쪽', '적타워'];
  const dist = Math.abs(playerPos - enemyPos);

  lines.push(`— ${turn}턴 —`);

  // 위치 + 거리
  let posLine = `내 위치: ${posName[playerPos]}`;
  if (player && player.inBush) posLine += ' (부쉬)';
  posLine += ` | 적 위치: `;
  if (enemy && enemy.inBush) {
    posLine += '부쉬 (시야 없음)';
  } else {
    posLine += posName[enemyPos];
  }
  posLine += ` | 거리: ${dist}칸`;
  if (dist <= 1) posLine += ' (근접)';
  else if (dist <= 2) posLine += ' (Q사거리)';
  else posLine += ' (원거리)';
  lines.push(posLine);

  // 스탯
  if (player && enemy) {
    const pHp = Math.round(player.hp);
    const eHp = Math.round(enemy.hp);
    lines.push(`내 HP: ${pHp}/${player.maxHp} (${Math.round(pHp/player.maxHp*100)}%) | 기력: ${Math.round(player.energy)} | CS: ${player.cs} | ${player.gold}G`);
    if (!enemy.inBush) {
      lines.push(`적 HP: ${eHp}/${enemy.maxHp} (${Math.round(eHp/enemy.maxHp*100)}%) | CS: ${enemy.cs}`);
    }
  }

  // 쿨다운
  if (player) {
    const cds = Object.entries(player.cooldowns)
      .map(([k, v]) => v > 0 ? `${k}:${v}턴` : `${k}:✓`)
      .join(' ');
    lines.push(`쿨다운: ${cds} | 포션: ${player.potions}개`);
  }

  // 미니언
  if (minionInfo > 0) {
    lines.push(`막타 가능 미니언: ${minionInfo}마리`);
  } else {
    lines.push('막타 가능 미니언 없음');
  }

  // 경고
  if (player && player.hp / player.maxHp < 0.3) lines.push('⚠️ 체력 위험');
  if (player && player.energy < 50) lines.push('⚠️ 기력 부족');
  if (enemy && !enemy.inBush && enemy.hp / enemy.maxHp < 0.3) lines.push('❗ 적 체력 낮음 — 킬 가능');

  return lines.join('\n');
}

export function getKillNarrative(killerName, victimName) {
  return `🔥 ${killerName}이(가) ${victimName}을(를) 처치했다! 🔥`;
}
