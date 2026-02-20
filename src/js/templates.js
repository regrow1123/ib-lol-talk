// Natural language choice/result templates in Korean

// Direction labels
const DIR = {
  center: '제자리', left: '왼쪽', right: '오른쪽', back: '뒤쪽', forward: '앞쪽'
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

export function getTurnSituation(turn, playerPos, enemyPos, minionInfo, player, enemy, minions) {
  const lines = [];
  const posName = ['아군타워', '아군쪽', '중앙', '적쪽', '적타워'];
  const dist = Math.abs(playerPos - enemyPos);

  lines.push(`— ${turn}턴 —`);

  // 챔피언 위치
  let posLine = `나: ${posName[playerPos]}`;
  posLine += ` | 적: ${posName[enemyPos]}`;
  posLine += ` | 거리 ${dist}칸`;
  lines.push(posLine);

  // 미니언 위치 + 상태
  const minionLines = [];
  if (minions) {
    const pAlive = minions.playerWave ? minions.playerWave.filter(m => m.hp > 0).length : 0;
    const eAlive = minions.enemyWave ? minions.enemyWave.filter(m => m.hp > 0).length : 0;
    minionLines.push(`미니언: 아군 ${pAlive}마리 vs 적 ${eAlive}마리`);
  }
  if (minionInfo > 0) {
    minionLines.push(`막타 가능: ${minionInfo}마리`);
  }
  if (minionLines.length > 0) lines.push(minionLines.join(' | '));

  return lines.join('\n');
}

export function getKillNarrative(killerName, victimName) {
  return `🔥 ${killerName}이(가) ${victimName}을(를) 처치했다! 🔥`;
}
