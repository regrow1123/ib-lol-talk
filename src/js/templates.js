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

  // Turn header
  lines.push(`— ${turn}번째 상황 —`);
  lines.push('');

  // Distance description
  const dist = Math.abs(playerPos - enemyPos);
  const posDesc = {
    0: '아군 타워 바로 앞',
    1: '아군 쪽 라인',
    2: '라인 한가운데',
    3: '적진 쪽 라인',
    4: '적 타워 코앞',
  };

  lines.push(`당신은 ${posDesc[playerPos]}에 서 있다.`);

  if (enemy && enemy.inBush) {
    lines.push('적 리신의 모습이 보이지 않는다. 부쉬에 숨어 있는 것 같다.');
  } else if (dist === 0) {
    lines.push('적 리신이 바로 눈앞에 있다. 숨결이 느껴질 정도로 가깝다.');
  } else if (dist === 1) {
    lines.push(`적 리신이 ${posDesc[enemyPos]}에서 이쪽을 주시하고 있다. Q 사거리 안이다.`);
  } else if (dist === 2) {
    lines.push(`적 리신이 ${posDesc[enemyPos]}에서 멀찍이 자리를 잡고 있다. 스킬이 닿을까 말까 한 거리.`);
  } else {
    lines.push(`적 리신이 ${posDesc[enemyPos]}에 있다. 상당히 멀리 떨어져 있다.`);
  }

  if (player && player.inBush) {
    lines.push('당신은 부쉬에 몸을 숨기고 있다. 적에게 보이지 않는다.');
  }

  // Minion info
  if (minionInfo > 0) {
    lines.push(`아군 미니언 웨이브 앞에서 적 미니언 ${minionInfo}마리의 체력이 위태롭다. 막타 타이밍이다.`);
  } else {
    lines.push('미니언들이 서로 부딪히며 싸우고 있다.');
  }

  // HP warnings
  if (player) {
    const pPct = player.hp / player.maxHp;
    if (pPct < 0.3) lines.push('⚠️ 체력이 위험하다. 한 번의 콤보에 죽을 수 있다.');
    else if (pPct < 0.5) lines.push('체력이 절반 아래로 떨어졌다. 조심해야 한다.');

    if (player.energy < 50) lines.push('기력이 거의 바닥이다. 스킬을 함부로 쓸 수 없다.');
  }

  if (enemy) {
    const ePct = enemy.hp / enemy.maxHp;
    if (ePct < 0.3) lines.push('적 리신의 체력이 낮다. 킬 찬스일 수 있다!');
    else if (ePct < 0.5) lines.push('적 리신도 체력이 많이 깎여 있다.');
  }

  return lines.join('\n');
}

export function getKillNarrative(killerName, victimName) {
  return `🔥 ${killerName}이(가) ${victimName}을(를) 처치했다! 🔥`;
}
