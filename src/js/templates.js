// Natural language choice/result templates in Korean - Intent System

// Intent text mapping
const INTENT_TEXT = {
  // Attack intents
  'Q1_CAST': '적이 위치를 고정할 거라 보고 음파(Q)를 날린다',
  'Q2_CAST': '음파가 적중한 적에게 공명타(Q2)로 돌진한다',
  'E1_CAST': '근접한 적에게 폭풍(E)으로 주변을 강타한다',
  'E2_CAST': '쇠약(E2)으로 적의 이동속도를 둔화시킨다',
  'AA_CHAMP': '적에게 기본공격을 가한다',
  'W1_SELF': '방호(W)를 사용해 자신에게 쉴드를 건다',
  'W1_MINION': '방호(W)로 아군 미니언에게 돌진한다',
  'W2_CAST': '철갑(W2)으로 생명력 흡수 효과를 얻는다',
  'R_CAST': '적에게 용의 분노(R)를 날려 뒤로 밀어낸다',

  // Positioning intents
  'PRESS': '대담하게 앞으로 걸어가며 적을 압박한다',
  'RETREAT': '위험을 느끼고 안전한 뒤쪽으로 물러선다',
  'ALL_IN': '과감하게 적에게 돌진해서 근접전을 건다',
  'MV_DODGE': '적의 공격이 올 것 같아 옆으로 몸을 뺀다',
  'BUSH_IN': '부쉬로 이동해서 시야를 차단한다',
  'BUSH_OUT': '부쉬에서 나와 레인으로 복귀한다',

  // CS intents
  'CS_SAFE': '미니언 뒤에서 안전하게 막타를 친다',
  'CS_PUSH': '적극적으로 미니언을 공격해서 라인을 민다',

  // Utility intents
  'POTION': '체력 포션을 마셔 체력을 회복한다',
  'RECALL': '귀환해서 아이템을 구매한다',
  'FLASH': '점멸로 즉시 위치를 이동한다',
  'IGNITE': '점화로 적에게 지속 피해를 준다',
};

// Get Korean text for intent
export function getIntentText(intent) {
  return INTENT_TEXT[intent] || `${intent} 행동`;
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
    blocked: '미니언에 막혔다!',
  };
  return `${attackerName}의 ${skillText[skill] || skill} ${reasons[reason] || '빗나갔다!'}`;
}

export function getCSNarrative(name, gold) {
  return `${name}이(가) 미니언을 처치했다! (+${gold}G)`;
}

export function getShieldNarrative(name, amount) {
  return `${name}이(가) 방호(W)로 ${Math.round(amount)}의 쉴드를 얻었다`;
}

export function getPositioningNarrative(name, intent) {
  const narratives = {
    'PRESS': `${name}이(가) 적극적으로 압박을 가했다`,
    'RETREAT': `${name}이(가) 안전한 위치로 후퇴했다`,
    'ALL_IN': `${name}이(가) 과감하게 돌진했다`,
    'MV_DODGE': `${name}이(가) 빠른 움직임으로 회피했다`,
    'BUSH_IN': `${name}이(가) 부쉬로 들어가 모습을 감췄다`,
    'BUSH_OUT': `${name}이(가) 부쉬에서 나와 레인으로 복귀했다`,
    'CS_SAFE': `${name}이(가) 미니언 뒤에서 안전하게 CS를 했다`,
    'CS_PUSH': `${name}이(가) 적극적으로 라인을 밀었다`,
  };
  return narratives[intent] || `${name}이(가) 위치를 조정했다`;
}

export function getTurnSituation(turn, playerX, enemyX, distance, minionInfo, player, enemy, minions) {
  const lines = [];
  
  lines.push(`— ${turn}턴 —`);

  // 챔피언 위치 (그리드 좌표를 의미있는 설명으로)
  const getPositionDesc = (x) => {
    if (x <= 10) return '아군 쪽';
    if (x <= 25) return '아군 라인';
    if (x <= 35) return '중앙';
    if (x <= 50) return '적 라인';
    return '적 쪽';
  };

  let posLine = `나: ${getPositionDesc(playerX)}(${playerX})`;
  posLine += ` | 적: ${getPositionDesc(enemyX)}(${enemyX})`;
  posLine += ` | 거리 ${distance}칸`;
  
  // 거리에 따른 전략적 상황 설명
  if (distance <= 3) {
    posLine += ' (근접전)';
  } else if (distance <= 9) {
    posLine += ' (E 사거리)';
  } else if (distance <= 24) {
    posLine += ' (Q 사거리)';
  } else {
    posLine += ' (원거리)';
  }
  
  lines.push(posLine);

  // 미니언 상황
  const minionLines = [];
  if (minions) {
    const pAlive = minions.playerWave ? minions.playerWave.filter(m => m.hp > 0).length : 0;
    const eAlive = minions.enemyWave ? minions.enemyWave.filter(m => m.hp > 0).length : 0;
    minionLines.push(`미니언: 아군 ${eAlive}마리 vs 적 ${pAlive}마리`);
  }
  if (minionInfo > 0) {
    minionLines.push(`막타 가능: ${minionInfo}마리`);
  }
  if (minionLines.length > 0) lines.push(minionLines.join(' | '));

  // 추가 전략 정보
  const strategyLines = [];
  if (player.energy < 50) {
    strategyLines.push('기력 부족');
  }
  if (enemy.hp / enemy.maxHp < 0.3) {
    strategyLines.push('적 체력 위험');
  }
  if (player.hp / player.maxHp < 0.3) {
    strategyLines.push('내 체력 위험');
  }
  if (strategyLines.length > 0) {
    lines.push(`상황: ${strategyLines.join(' | ')}`);
  }

  return lines.join('\n');
}

export function getKillNarrative(killerName, victimName) {
  return `🔥 ${killerName}이(가) ${victimName}을(를) 처치했다! 🔥`;
}

// Legacy functions for compatibility (can be removed later if not used)
export function getAttackChoiceText(skill, direction) {
  return getIntentText(`${skill}_CAST`);
}

export function getCSChoiceText(hasMinion) {
  return hasMinion ? getIntentText('CS_SAFE') : getIntentText('CS_PUSH');
}

export function getMoveChoiceText(direction) {
  const directionMap = {
    'left': 'MV_DODGE',
    'right': 'MV_DODGE', 
    'back': 'RETREAT',
    'forward': 'PRESS',
  };
  return getIntentText(directionMap[direction] || 'MV_DODGE');
}

export function getDefenseChoiceText(type) {
  const defenseMap = {
    'W1': 'W1_SELF',
    'POTION': 'POTION',
  };
  return getIntentText(defenseMap[type] || 'W1_SELF');
}

export function getQ2ChoiceText() {
  return getIntentText('Q2_CAST');
}

export function getW2ChoiceText() {
  return getIntentText('W2_CAST');
}

export function getE2ChoiceText() {
  return getIntentText('E2_CAST');
}