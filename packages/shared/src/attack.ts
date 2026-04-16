export interface AttackContext {
  linesCleared: number;
  isTSpin: boolean;
  backToBack: boolean;
  combo: number;
}

export function calculateAttack(context: AttackContext): number {
  const { linesCleared, isTSpin, backToBack, combo } = context;

  if (linesCleared === 0) {
    return 0;
  }

  let attack = 0;

  if (isTSpin) {
    if (linesCleared === 1) {
      attack = 2;
    } else if (linesCleared === 2) {
      attack = 4;
    } else if (linesCleared >= 3) {
      attack = 6;
    }
  } else {
    if (linesCleared === 2) {
      attack = 1;
    } else if (linesCleared === 3) {
      attack = 2;
    } else if (linesCleared >= 4) {
      attack = 4;
    }
  }

  if (backToBack && (isTSpin || linesCleared >= 4)) {
    attack += 1;
  }

  if (combo > 1) {
    attack += Math.min(combo - 1, 4);
  }

  return attack;
}
