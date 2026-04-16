import { HIDDEN_ROWS } from "@tetris-arena/shared";
import type { BoardSnapshot } from "@tetris-arena/shared";
import { NEON_COLORS } from "./cellTextures.js";

export interface BoardAnimState {
  clearFlashUntil: number;
  clearFlashStrength: number;
  lockFlashUntil: number;
  lockFlashColor: number;
  garbageFlashUntil: number;
  garbageFlashStrength: number;
  shakeUntil: number;
  shakeStrength: number;
  dangerActive: boolean;
  topOut: boolean;
  prevLinesClearedTotal: number;
  prevPiecesLocked: number;
  prevPendingGarbage: number;
  prevActiveType: string | null;
}

export function createBoardAnimState(): BoardAnimState {
  return {
    clearFlashUntil: 0,
    clearFlashStrength: 0,
    lockFlashUntil: 0,
    lockFlashColor: 0xffffff,
    garbageFlashUntil: 0,
    garbageFlashStrength: 0,
    shakeUntil: 0,
    shakeStrength: 0,
    dangerActive: false,
    topOut: false,
    prevLinesClearedTotal: 0,
    prevPiecesLocked: 0,
    prevPendingGarbage: 0,
    prevActiveType: null
  };
}

export function tickAnimState(state: BoardAnimState, snapshot: BoardSnapshot): void {
  const now = performance.now();

  const linesDelta = snapshot.linesClearedTotal - state.prevLinesClearedTotal;
  if (linesDelta > 0) {
    state.clearFlashStrength = Math.min(1, 0.42 + linesDelta * 0.14);
    state.clearFlashUntil = now + 420;
    state.shakeUntil = Math.max(state.shakeUntil, now + 200);
    state.shakeStrength = Math.max(state.shakeStrength, 0.4);
  }

  if (snapshot.piecesLocked > state.prevPiecesLocked) {
    const hex = NEON_COLORS[state.prevActiveType ?? ""] ?? "#ffffff";
    state.lockFlashColor = parseInt(hex.slice(1), 16);
    state.lockFlashUntil = now + 130;
  }

  const pendingDelta = snapshot.pendingGarbage - state.prevPendingGarbage;
  if (pendingDelta > 0) {
    state.garbageFlashStrength = Math.min(0.6, 0.35 + pendingDelta * 0.12);
    state.garbageFlashUntil = now + 320;
    state.shakeStrength = Math.max(state.shakeStrength, 0.5);
    state.shakeUntil = Math.max(state.shakeUntil, now + 220);
  }

  // Danger: stack in top 6 visible rows
  const topOccupied = snapshot.board.findIndex(row => row.some(c => c !== null));
  state.dangerActive = topOccupied !== -1 && topOccupied < HIDDEN_ROWS + 6;

  state.topOut = snapshot.isTopOut;

  state.prevLinesClearedTotal = snapshot.linesClearedTotal;
  state.prevPiecesLocked = snapshot.piecesLocked;
  state.prevPendingGarbage = snapshot.pendingGarbage;
  state.prevActiveType = snapshot.active?.type ?? null;
}
