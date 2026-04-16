import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FAST_GRAVITY_MIN_MS,
  FAST_GRAVITY_START_MS,
  FAST_GRAVITY_STEP_LINES,
  FAST_GRAVITY_STEP_MS,
  GARBAGE_HOLE_MAX,
  GARBAGE_HOLE_MIN,
  HIDDEN_ROWS,
  LOCK_DELAY_MS,
  MAX_LOCK_RESETS,
  PREVIEW_COUNT
} from "./constants.js";
import { calculateAttack } from "./attack.js";
import { getKickTests, PIECES } from "./pieces.js";
import { createSeed, nextRandom, shuffleBag } from "./random.js";
import { createScoringEvent, getLevel } from "./score.js";
import type {
  ActivePiece,
  BoardSnapshot,
  CellValue,
  GameplayResolution,
  InputAction,
  InternalPlayerState,
  PieceType
} from "./types.js";

function createEmptyBoard(): CellValue[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => Array.from({ length: BOARD_WIDTH }, () => null));
}

export function getGravityDelayMs(linesClearedTotal: number): number {
  const step = Math.floor(linesClearedTotal / FAST_GRAVITY_STEP_LINES);
  return Math.max(FAST_GRAVITY_MIN_MS, FAST_GRAVITY_START_MS - step * FAST_GRAVITY_STEP_MS);
}

function cloneBoard(board: CellValue[][]): CellValue[][] {
  return board.map((row) => [...row]);
}

function getCells(piece: ActivePiece): { x: number; y: number }[] {
  return PIECES[piece.type][piece.rotation]!.map((cell) => ({
    x: piece.x + cell.x,
    y: piece.y + cell.y
  }));
}

function collides(board: CellValue[][], piece: ActivePiece): boolean {
  return getCells(piece).some(({ x, y }) => {
    if (x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT) {
      return true;
    }

    if (y < 0) {
      return false;
    }

    return board[y]?.[x] !== null;
  });
}

function mergePiece(board: CellValue[][], piece: ActivePiece): CellValue[][] {
  const merged = cloneBoard(board);

  for (const { x, y } of getCells(piece)) {
    if (y >= 0) {
      merged[y]![x] = piece.type;
    }
  }

  return merged;
}

function refillQueue(state: InternalPlayerState): void {
  while (state.queue.length < PREVIEW_COUNT + 2) {
    if (state.bag.length === 0) {
      const [bag, nextSeed] = shuffleBag(state.rngState);
      state.bag = bag;
      state.rngState = nextSeed;
    }

    state.queue.push(state.bag.shift()!);
  }
}

function nextPiece(state: InternalPlayerState): PieceType {
  refillQueue(state);
  return state.queue.shift()!;
}

function createSpawn(type: PieceType): ActivePiece {
  return {
    type,
    rotation: 0,
    x: 3,
    y: 0
  };
}

function activatePiece(state: InternalPlayerState, type: PieceType): void {
  const piece = createSpawn(type);
  state.lockTimerMs = 0;
  state.lockResets = 0;
  state.gravityTimerMs = 0;

  if (collides(state.board, piece)) {
    state.isTopOut = true;
    state.active = null;
    return;
  }

  // Official rule: immediately drop one row if path is clear
  const dropped: ActivePiece = { ...piece, y: piece.y + 1 };
  state.active = collides(state.board, dropped) ? piece : dropped;
}

function spawnNextPiece(state: InternalPlayerState): void {
  if (state.isTopOut) {
    return;
  }

  state.needsSpawn = false;
  activatePiece(state, nextPiece(state));
}

function clearLines(board: CellValue[][]): { board: CellValue[][]; linesCleared: number } {
  const survivors = board.filter((row) => row.some((cell) => cell === null));
  const linesCleared = board.length - survivors.length;
  const emptyRows: CellValue[][] = Array.from({ length: linesCleared }, () =>
    Array.from({ length: BOARD_WIDTH }, (): CellValue => null)
  );
  const nextBoard = [...emptyRows, ...survivors];
  return { board: nextBoard, linesCleared };
}

function isGrounded(board: CellValue[][], piece: ActivePiece): boolean {
  return collides(board, { ...piece, y: piece.y + 1 });
}

function tryMove(state: InternalPlayerState, dx: number, dy: number): boolean {
  if (!state.active) {
    return false;
  }

  const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  if (collides(state.board, candidate)) {
    return false;
  }

  state.active = candidate;
  if (!isGrounded(state.board, candidate)) {
    state.lockTimerMs = 0;
  } else if (dx !== 0 && state.lockResets < MAX_LOCK_RESETS) {
    state.lockResets += 1;
    state.lockTimerMs = 0;
  }
  return true;
}

function detectTSpin(board: CellValue[][], piece: ActivePiece): boolean {
  if (piece.type !== "T") return false;

  const cx = piece.x + 1;
  const cy = piece.y + 1;
  let filled = 0;

  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT || board[y]?.[x] !== null) {
      filled += 1;
    }
  }

  return filled >= 3;
}

function rotate(state: InternalPlayerState, direction: 1 | -1): boolean {
  if (!state.active) {
    return false;
  }

  const from = state.active.rotation;
  const to = (from + direction + 4) % 4;
  const kicks = getKickTests(state.active.type, from, to);

  for (const kick of kicks) {
    const candidate = {
      ...state.active,
      rotation: to,
      x: state.active.x + kick.x,
      y: state.active.y - kick.y
    };

    if (!collides(state.board, candidate)) {
      state.active = candidate;
      if (!isGrounded(state.board, candidate)) {
        state.lockTimerMs = 0;
      } else if (state.lockResets < MAX_LOCK_RESETS) {
        state.lockResets += 1;
        state.lockTimerMs = 0;
      }
      return true;
    }
  }

  return false;
}

function lockPiece(state: InternalPlayerState): GameplayResolution {
  if (!state.active) {
    return {
      locked: false,
      linesCleared: 0,
      attackSent: 0,
      topOut: state.isTopOut
    };
  }

  const piece = state.active;

  // Detect T-spin BEFORE merging — needs empty board corners for the 3-corner check
  const isTSpin = detectTSpin(state.board, piece);

  state.board = mergePiece(state.board, piece);
  const { board, linesCleared } = clearLines(state.board);
  state.board = board;
  state.linesClearedTotal += linesCleared;
  state.piecesLocked += 1;

  const qualifiesB2B = (isTSpin && linesCleared > 0) || linesCleared >= 4;
  state.combo = linesCleared > 0 ? state.combo + 1 : 0;
  const attackSent = calculateAttack({
    linesCleared,
    isTSpin,
    backToBack: state.backToBack,
    combo: state.combo
  });
  const receivesBackToBackBonus = Boolean(linesCleared > 0 && qualifiesB2B && state.backToBack);

  if (qualifiesB2B && linesCleared > 0) {
    state.backToBack = true;
  } else if (linesCleared > 0) {
    state.backToBack = false;
  }

  state.scoringEventId += 1;
  state.lastScoringEvent = createScoringEvent({
    id: state.scoringEventId,
    linesCleared,
    combo: state.combo,
    backToBack: receivesBackToBackBonus,
    isTSpin,
    linesClearedTotal: state.linesClearedTotal
  });
  state.score += state.lastScoringEvent.points;

  state.garbageSentTotal += attackSent;
  state.active = null;
  state.canHold = true;
  state.lockTimerMs = 0;
  state.lockResets = 0;
  state.gravityTimerMs = 0;
  state.needsSpawn = true;

  // Lock-out: all cells locked above the skyline (in hidden rows)
  if (linesCleared === 0 && getCells(piece).every(c => c.y < HIDDEN_ROWS)) {
    state.isTopOut = true;
  }

  const resolution = {
    locked: true,
    linesCleared,
    attackSent,
    topOut: state.isTopOut
  };
  state.lastResolution = resolution;
  return resolution;
}

export function createPlayerState(seed = createSeed()): InternalPlayerState {
  const state: InternalPlayerState = {
    board: createEmptyBoard(),
    active: null,
    hold: null,
    canHold: true,
    queue: [],
    bag: [],
    combo: 0,
    backToBack: false,
    pendingGarbage: 0,
    rngState: seed,
    gravityTimerMs: 0,
    lockTimerMs: 0,
    lockResets: 0,
    linesClearedTotal: 0,
    garbageSentTotal: 0,
    score: 0,
    piecesLocked: 0,
    scoringEventId: 0,
    lastScoringEvent: null,
    isTopOut: false,
    needsSpawn: true,
    lastResolution: null
  };

  refillQueue(state);
  spawnNextPiece(state);
  return state;
}

export function applyInputAction(state: InternalPlayerState, action: InputAction): GameplayResolution | null {
  if (!state.active || state.isTopOut) {
    return null;
  }

  switch (action) {
    case "moveLeft":
      tryMove(state, -1, 0);
      break;
    case "moveRight":
      tryMove(state, 1, 0);
      break;
    case "rotateCW":
      rotate(state, 1);
      break;
    case "rotateCCW":
      rotate(state, -1);
      break;
    case "softDrop":
      tryMove(state, 0, 1);
      break;
    case "hardDrop":
      while (tryMove(state, 0, 1)) {
        // Hard drop intentionally steps until grounded.
      }
      return lockPiece(state);
    case "hold": {
      if (!state.canHold || !state.active) {
        break;
      }

      const held = state.hold;
      state.hold = state.active.type;
      state.canHold = false;
      activatePiece(state, held ?? nextPiece(state));
      break;
    }
  }

  state.lastResolution = null;
  return null;
}

export function tickPlayerState(state: InternalPlayerState, deltaMs: number): GameplayResolution | null {
  if (state.isTopOut || !state.active) {
    return null;
  }

  state.gravityTimerMs += deltaMs;
  let resolution: GameplayResolution | null = null;
  const gravityDelayMs = getGravityDelayMs(state.linesClearedTotal);

  while (state.gravityTimerMs >= gravityDelayMs) {
    state.gravityTimerMs -= gravityDelayMs;
    if (!tryMove(state, 0, 1)) {
      break;
    }
  }

  if (state.active && isGrounded(state.board, state.active)) {
    state.lockTimerMs += deltaMs;
    if (state.lockTimerMs >= LOCK_DELAY_MS) {
      resolution = lockPiece(state);
    }
  } else {
    state.lockTimerMs = 0;
  }

  return resolution;
}

export function enqueueGarbage(state: InternalPlayerState, lines: number): void {
  state.pendingGarbage += lines;
}

export function finalizeAfterLock(state: InternalPlayerState): void {
  if (!state.needsSpawn || state.isTopOut) {
    return;
  }

  if (state.pendingGarbage > 0) {
    applyPendingGarbage(state);
  }

  spawnNextPiece(state);
}

function applyPendingGarbage(state: InternalPlayerState): void {
  const lines = state.pendingGarbage;
  state.pendingGarbage = 0;
  let rngState = state.rngState;

  for (let count = 0; count < lines; count += 1) {
    const [value, nextSeed] = nextRandom(rngState);
    rngState = nextSeed;
    const hole = Math.floor(value * (GARBAGE_HOLE_MAX - GARBAGE_HOLE_MIN + 1)) + GARBAGE_HOLE_MIN;
    state.board.shift();
    state.board.push(
      Array.from({ length: BOARD_WIDTH }, (_, index) => (index === hole ? null : "garbage"))
    );
  }

  state.rngState = rngState;
}

export function cancelPendingGarbage(state: InternalPlayerState, attack: number): number {
  const cancelled = Math.min(state.pendingGarbage, attack);
  state.pendingGarbage -= cancelled;
  return attack - cancelled;
}

export function getBoardSnapshot(state: InternalPlayerState): BoardSnapshot {
  return {
    board: state.active ? mergePiece(state.board, state.active) : cloneBoard(state.board),
    active: state.active ? { ...state.active } : null,
    hold: state.hold,
    queue: state.queue.slice(0, PREVIEW_COUNT),
    canHold: state.canHold,
    combo: state.combo,
    backToBack: state.backToBack,
    pendingGarbage: state.pendingGarbage,
    linesClearedTotal: state.linesClearedTotal,
    garbageSentTotal: state.garbageSentTotal,
    score: state.score,
    level: getLevel(state.linesClearedTotal),
    piecesLocked: state.piecesLocked,
    lastScoringEvent: state.lastScoringEvent ? { ...state.lastScoringEvent } : null,
    isTopOut: state.isTopOut
  };
}
