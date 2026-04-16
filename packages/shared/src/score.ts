import type { ScoringEvent } from "./types.js";

export const DROP_LOCK_SCORE = 3;
export const LINE_CLEAR_SCORES: Record<number, number> = {
  1: 10,
  2: 25,
  3: 75,
  4: 200
};

export function getLevel(linesClearedTotal: number): number {
  return Math.floor(linesClearedTotal / 10) + 1;
}

export function createScoringEvent(options: {
  id: number;
  linesCleared: number;
  combo: number;
  backToBack: boolean;
  isTSpin: boolean;
  linesClearedTotal: number;
}): ScoringEvent {
  const level = getLevel(options.linesClearedTotal);
  const baseClearScore = LINE_CLEAR_SCORES[options.linesCleared] ?? 0;
  const clearPoints = baseClearScore * level;
  const dropPoints = DROP_LOCK_SCORE;
  const comboBonus = options.combo > 1 ? (options.combo - 1) * 15 * level : 0;
  const backToBackBonus = options.backToBack ? Math.max(6, Math.floor(baseClearScore * 0.5)) * level : 0;
  const points = dropPoints + clearPoints + comboBonus + backToBackBonus;

  return {
    id: options.id,
    points,
    dropPoints,
    clearPoints,
    comboBonus,
    backToBackBonus,
    level,
    linesCleared: options.linesCleared,
    combo: options.combo,
    qualifiesBackToBack: options.backToBack,
    isTSpin: options.isTSpin,
    label: getScoreLabel(options.linesCleared, options.backToBack, options.combo)
  };
}

export function getScoreLabel(linesCleared: number, backToBack: boolean, combo: number): string | null {
  const clearLabel = (
    linesCleared === 4 ? "TETRIS" :
    linesCleared === 3 ? "TRIPLE" :
    linesCleared === 2 ? "DOUBLE" :
    linesCleared === 1 ? "SINGLE" :
    null
  );

  const comboLabel = combo > 1 ? `COMBO x${combo}` : null;
  if (clearLabel && backToBack) {
    return `BACK-TO-BACK ${clearLabel}`;
  }

  return clearLabel ?? comboLabel;
}
