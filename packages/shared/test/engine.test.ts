import { describe, expect, it } from "vitest";
import {
  applyInputAction,
  cancelPendingGarbage,
  createScoringEvent,
  createPlayerState,
  enqueueGarbage,
  finalizeAfterLock,
  getGravityDelayMs,
  getLevel,
  getBoardSnapshot,
  tickPlayerState,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HIDDEN_ROWS,
  PIECES
} from "../src/index.js";
import type { InternalPlayerState } from "../src/types.js";

// Fill every cell in a row with garbage.
function fillRow(state: InternalPlayerState, row: number): void {
  state.board[row] = Array(BOARD_WIDTH).fill("garbage");
}

// Fill rows [start, end) with garbage, leaving openCol empty.
function fillRowsExcept(
  state: InternalPlayerState,
  startRow: number,
  endRow: number,
  openCol: number
): void {
  for (let y = startRow; y < endRow; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      state.board[y]![x] = x === openCol ? null : "garbage";
    }
  }
}

describe("shared engine", () => {
  // ─── Existing smoke tests ─────────────────────────────────────────────────

  it("spawns a playable state", () => {
    const state = createPlayerState(1234);
    const snapshot = getBoardSnapshot(state);
    expect(snapshot.active).not.toBeNull();
    expect(snapshot.queue).toHaveLength(5);
  });

  it("hard drops and locks a piece", () => {
    const state = createPlayerState(99);
    const resolution = applyInputAction(state, "hardDrop");
    expect(resolution?.locked).toBe(true);
    finalizeAfterLock(state);
    expect(state.active).not.toBeNull();
  });

  it("cancels pending garbage before sending more", () => {
    const state = createPlayerState(5);
    enqueueGarbage(state, 3);
    const remainder = cancelPendingGarbage(state, 5);
    expect(state.pendingGarbage).toBe(0);
    expect(remainder).toBe(2);
  });

  it("ramps gravity as more lines are cleared", () => {
    expect(getGravityDelayMs(0)).toBe(550);
    expect(getGravityDelayMs(16)).toBe(460);
    expect(getGravityDelayMs(96)).toBe(110);
  });

  it("calculates score events with level, combo, and back-to-back bonuses", () => {
    const event = createScoringEvent({
      id: 1,
      linesCleared: 4,
      combo: 3,
      backToBack: true,
      isTSpin: false,
      linesClearedTotal: 20
    });

    expect(getLevel(20)).toBe(3);
    expect(event.clearPoints).toBe(600);
    expect(event.comboBonus).toBe(90);
    expect(event.backToBackBonus).toBe(300);
    expect(event.points).toBe(993);
  });

  // ─── Spawn position ───────────────────────────────────────────────────────

  it("spawns active piece at y=1 on an empty board (auto-drop succeeds)", () => {
    const state = createPlayerState(1234);
    // All pieces in rotation 0 have cells at y-offsets 0 and 1.
    // createSpawn places them at y=0; activatePiece immediately drops to y=1 if clear.
    expect(state.active).not.toBeNull();
    expect(state.active!.y).toBe(1);
    expect(state.active!.x).toBe(3);
    expect(state.active!.rotation).toBe(0);
  });

  it("piece stays at y=0 when auto-drop row is blocked", () => {
    const state = createPlayerState(1234);
    applyInputAction(state, "hardDrop"); // lock first piece

    // Block the first visible row so auto-drop fails for the next spawn
    fillRow(state, HIDDEN_ROWS); // row 2 = first visible row

    state.queue = ["T", ...state.queue];
    finalizeAfterLock(state);

    // T(0) at y=1 would need row 2 to be clear — it's not, so stays at y=0
    expect(state.active!.y).toBe(0);
  });

  // ─── Block-out (spawn position occupied) ─────────────────────────────────

  it("block-out: isTopOut when the spawn position is fully blocked", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    // Block hidden rows so no piece can spawn
    state.board[0] = Array(BOARD_WIDTH).fill("garbage");
    state.board[1] = Array(BOARD_WIDTH).fill("garbage");

    finalizeAfterLock(state);

    expect(state.isTopOut).toBe(true);
    expect(state.active).toBeNull();
  });

  // ─── Lock-out (all cells in hidden rows at lock time) ────────────────────

  it("lock-out: isTopOut when all piece cells lock above the skyline", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    // Fill ONLY the cells directly below T(0)'s bottom row so the piece is grounded
    // without making row 2 completely full (a full row would clear, making linesCleared≠0).
    // T(0) at y=0 has bottom cells at (3,1),(4,1),(5,1); cells directly below = (3,2),(4,2),(5,2).
    state.queue = ["T", ...state.queue];
    state.board[2]![3] = "garbage";
    state.board[2]![4] = "garbage";
    state.board[2]![5] = "garbage";
    finalizeAfterLock(state);

    // T stays at y=0 because auto-drop would put cells at (3,2),(4,2),(5,2) which are blocked
    expect(state.active!.y).toBe(0);

    // Hard drop (grounded by those 3 cells) → locks at y=0 → all cells in hidden rows, 0 lines cleared
    const result = applyInputAction(state, "hardDrop");
    expect(result?.topOut).toBe(true);
    expect(state.isTopOut).toBe(true);
  });

  // ─── Soft drop ────────────────────────────────────────────────────────────

  it("soft drop moves piece down one row and returns null", () => {
    const state = createPlayerState(42);
    const before = state.active!.y;
    const result = applyInputAction(state, "softDrop");
    expect(result).toBeNull();
    expect(state.active).not.toBeNull();
    expect(state.active!.y).toBe(before + 1);
  });

  it("soft drop while grounded returns null (does not lock)", () => {
    const state = createPlayerState(42);
    // Move piece to near the bottom
    state.active = { ...state.active!, y: BOARD_HEIGHT - 3 };
    fillRow(state, BOARD_HEIGHT - 2);
    fillRow(state, BOARD_HEIGHT - 1);

    const result = applyInputAction(state, "softDrop");
    expect(result).toBeNull();
    expect(state.active).not.toBeNull(); // piece was not locked
  });

  // ─── Lock timer reset ─────────────────────────────────────────────────────

  it("horizontal move while grounded resets lock timer and increments lockResets", () => {
    const state = createPlayerState(42);
    state.active = { ...state.active!, y: BOARD_HEIGHT - 4 };
    fillRow(state, BOARD_HEIGHT - 2);
    fillRow(state, BOARD_HEIGHT - 1);

    state.lockTimerMs = 400;
    applyInputAction(state, "moveLeft");

    expect(state.lockTimerMs).toBe(0);
    expect(state.lockResets).toBe(1);
  });

  it("repeated horizontal moves increment lockResets up to the limit", () => {
    const state = createPlayerState(42);
    state.active = { ...state.active!, y: BOARD_HEIGHT - 4 };
    fillRow(state, BOARD_HEIGHT - 2);
    fillRow(state, BOARD_HEIGHT - 1);

    for (let i = 0; i < 20; i++) {
      applyInputAction(state, i % 2 === 0 ? "moveLeft" : "moveRight");
    }
    // MAX_LOCK_RESETS = 15; should not exceed it
    expect(state.lockResets).toBeLessThanOrEqual(15);
  });

  it("tickPlayerState locks piece after LOCK_DELAY_MS (500ms) when grounded", () => {
    const state = createPlayerState(42);
    state.active = { ...state.active!, y: BOARD_HEIGHT - 3 };
    fillRow(state, BOARD_HEIGHT - 2);
    fillRow(state, BOARD_HEIGHT - 1);

    const result = tickPlayerState(state, 501);
    expect(result?.locked).toBe(true);
  });

  it("tickPlayerState is a no-op when isTopOut", () => {
    const state = createPlayerState(42);
    state.isTopOut = true;
    const before = state.piecesLocked;
    tickPlayerState(state, 1000);
    expect(state.piecesLocked).toBe(before);
  });

  // ─── T-spin detection ─────────────────────────────────────────────────────

  it("T-spin: isTSpin=true when 3+ diagonal corners around T-center are filled", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");

    // T(2) = South at x=3, y=17. Center = (4, 18).
    // Corners: (3,17), (5,17), (3,19), (5,19).
    state.active = { type: "T", rotation: 2, x: 3, y: 17 };
    state.board[17]![3] = "garbage"; // corner (-1,-1)
    state.board[17]![5] = "garbage"; // corner (+1,-1)
    fillRow(state, 19); // fills corners (3,19) and (5,19) → 4 corners total

    // isGrounded: T at y=17, try y=18 → cells hit full row 19 → grounded
    const result = applyInputAction(state, "hardDrop");
    expect(result?.locked).toBe(true);
    expect(state.lastScoringEvent?.isTSpin).toBe(true);
    expect(result?.linesCleared).toBe(1); // row 19 clears
  });

  it("T-spin: isTSpin=false when fewer than 3 corners are filled (no surrounding blocks)", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");

    // T(0) = North at x=3, y=17. Center = (4, 18).
    // No corner blocks → corners at (3,17),(5,17) = empty; (3,19),(5,19) need row 19.
    state.active = { type: "T", rotation: 0, x: 3, y: 17 };
    fillRow(state, 19); // only 2 corners ((3,19),(5,19)) filled from row 19

    const result = applyInputAction(state, "hardDrop");
    expect(result?.locked).toBe(true);
    expect(state.lastScoringEvent?.isTSpin).toBe(false);
  });

  it("T-spin: non-T piece never counts as T-spin", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");

    // Fill corners around where an I-piece would land
    state.active = { type: "I", rotation: 0, x: 3, y: 17 };
    state.board[17]![3] = "garbage";
    state.board[17]![5] = "garbage";
    fillRow(state, 19);

    const result = applyInputAction(state, "hardDrop");
    expect(result?.locked).toBe(true);
    expect(state.lastScoringEvent?.isTSpin).toBe(false);
  });

  // ─── Back-to-back ─────────────────────────────────────────────────────────

  it("backToBack is set after a Tetris (4-line clear)", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    fillRowsExcept(state, BOARD_HEIGHT - 4, BOARD_HEIGHT, 9);
    state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
    const result = applyInputAction(state, "hardDrop");

    expect(result?.linesCleared).toBe(4);
    expect(state.backToBack).toBe(true);
  });

  it("B2B bonus awarded on consecutive Tetrises", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    // First Tetris
    fillRowsExcept(state, BOARD_HEIGHT - 4, BOARD_HEIGHT, 9);
    state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
    applyInputAction(state, "hardDrop");
    expect(state.backToBack).toBe(true);

    // Reset combo to 0 with a non-clearing lock (combo=1 after first Tetris would add
    // an unwanted +1 to the second Tetris attack via the combo > 1 bonus).
    finalizeAfterLock(state);
    state.active = { type: "O", rotation: 0, x: 0, y: 1 };
    applyInputAction(state, "hardDrop"); // locks without clearing → combo = 0

    // Second Tetris (back-to-back, combo=0 → becomes 1 after clear → no combo bonus)
    finalizeAfterLock(state);
    fillRowsExcept(state, BOARD_HEIGHT - 4, BOARD_HEIGHT, 9);
    state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
    applyInputAction(state, "hardDrop");

    expect(state.lastScoringEvent?.qualifiesBackToBack).toBe(true);
    expect(state.lastResolution?.attackSent).toBe(5); // 4 base + 1 B2B
  });

  it("B2B chain breaks on a non-qualifying clear (double)", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    // Establish B2B with a Tetris
    fillRowsExcept(state, BOARD_HEIGHT - 4, BOARD_HEIGHT, 9);
    state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
    applyInputAction(state, "hardDrop");
    expect(state.backToBack).toBe(true);

    // Two pre-filled full rows; any locked piece causes a double clear → breaks B2B
    finalizeAfterLock(state);
    fillRow(state, BOARD_HEIGHT - 2);
    fillRow(state, BOARD_HEIGHT - 1);
    state.active = { type: "I", rotation: 0, x: 3, y: BOARD_HEIGHT - 4 };
    applyInputAction(state, "hardDrop");

    // linesCleared = 2 → not qualifying → backToBack resets
    expect(state.backToBack).toBe(false);
  });

  it("T-spin single qualifies for B2B", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");

    state.active = { type: "T", rotation: 2, x: 3, y: 17 };
    state.board[17]![3] = "garbage";
    state.board[17]![5] = "garbage";
    fillRow(state, 19);

    applyInputAction(state, "hardDrop");

    expect(state.backToBack).toBe(true);
    expect(state.lastScoringEvent?.isTSpin).toBe(true);
  });

  // ─── Combo ────────────────────────────────────────────────────────────────

  it("combo increments on consecutive line clears", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    for (let i = 0; i < 3; i++) {
      finalizeAfterLock(state);
      // Each iteration: fill bottom row except col 9, drop a vertical I into col 9
      fillRowsExcept(state, BOARD_HEIGHT - 1, BOARD_HEIGHT, 9);
      state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
      applyInputAction(state, "hardDrop");
    }

    expect(state.combo).toBe(3);
  });

  it("combo resets to 0 when a piece locks without clearing", () => {
    const state = createPlayerState(1);
    applyInputAction(state, "hardDrop");

    // Clear once to establish a combo
    finalizeAfterLock(state);
    fillRowsExcept(state, BOARD_HEIGHT - 1, BOARD_HEIGHT, 9);
    state.active = { type: "I", rotation: 1, x: 7, y: BOARD_HEIGHT - 4 };
    applyInputAction(state, "hardDrop");
    expect(state.combo).toBe(1);

    // Lock without clearing — artificially set combo to 2 first
    finalizeAfterLock(state);
    state.combo = 2;
    // Place O-piece in upper area; board is mostly empty so no rows complete
    state.active = { type: "O", rotation: 0, x: 0, y: 1 };
    applyInputAction(state, "hardDrop");

    expect(state.combo).toBe(0);
  });

  // ─── Garbage mechanics ────────────────────────────────────────────────────

  it("pending garbage is applied before spawning the next piece", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");

    enqueueGarbage(state, 3);
    finalizeAfterLock(state);

    // Bottom 3 rows should each have (BOARD_WIDTH-1) garbage cells + 1 hole
    let garbageRowCount = 0;
    for (let y = BOARD_HEIGHT - 3; y < BOARD_HEIGHT; y++) {
      const garbageCells = state.board[y]!.filter(c => c === "garbage").length;
      if (garbageCells === BOARD_WIDTH - 1) garbageRowCount++;
    }
    expect(garbageRowCount).toBe(3);
  });

  it("garbage is not applied after a top-out", () => {
    const state = createPlayerState(42);
    applyInputAction(state, "hardDrop");
    state.isTopOut = true;
    enqueueGarbage(state, 5);

    const boardSnapshot = state.board.map(r => [...r]);
    finalizeAfterLock(state);

    expect(state.board).toEqual(boardSnapshot);
  });

  // ─── Hold mechanics ───────────────────────────────────────────────────────

  it("hold with empty slot draws the next piece from queue", () => {
    const state = createPlayerState(100);
    const firstType = state.active!.type;
    const secondType = state.queue[0]!;

    applyInputAction(state, "hold");

    expect(state.hold).toBe(firstType);
    expect(state.active!.type).toBe(secondType);
    expect(state.canHold).toBe(false);
  });

  it("hold with existing held piece swaps active and hold", () => {
    const state = createPlayerState(100);
    const firstType = state.active!.type;

    applyInputAction(state, "hold"); // A → hold, B becomes active
    applyInputAction(state, "hardDrop"); // lock B
    finalizeAfterLock(state);         // C spawns

    const cType = state.active!.type;
    applyInputAction(state, "hold"); // C → hold, A (from hold) becomes active

    expect(state.hold).toBe(cType);
    expect(state.active!.type).toBe(firstType);
  });

  it("hold is disabled after use until the next piece is locked", () => {
    const state = createPlayerState(100);
    const firstType = state.active!.type;

    applyInputAction(state, "hold"); // first hold: valid
    const holdAfterFirst = state.hold;
    const activeAfterFirst = state.active!.type;

    applyInputAction(state, "hold"); // second hold: should be ignored
    expect(state.hold).toBe(holdAfterFirst);    // hold slot unchanged
    expect(state.active!.type).toBe(activeAfterFirst); // active unchanged
  });

  it("held piece activates via auto-drop (spawns at y=1 on empty board)", () => {
    const state = createPlayerState(100);

    applyInputAction(state, "hold");    // A → hold, B active
    applyInputAction(state, "hardDrop"); // lock B
    finalizeAfterLock(state);           // C spawns
    applyInputAction(state, "hold");    // C → hold, A re-activates

    expect(state.active!.y).toBe(1);   // auto-dropped from y=0 to y=1
  });

  // ─── piecesLocked counter ─────────────────────────────────────────────────

  it("piecesLocked increments on each hard drop", () => {
    const state = createPlayerState(7);
    expect(state.piecesLocked).toBe(0);
    applyInputAction(state, "hardDrop");
    expect(state.piecesLocked).toBe(1);
    finalizeAfterLock(state);
    applyInputAction(state, "hardDrop");
    expect(state.piecesLocked).toBe(2);
  });

  // ─── Piece rotation correctness ───────────────────────────────────────────

  it("J(1) vertical bar is at x=1 with flag extending to x=2 (top-right)", () => {
    // J(1) must be {(1,0),(2,0),(1,1),(1,2)}: flag at top-right per SRS mirror symmetry
    const j1 = PIECES.J[1]!;
    const xVals = j1.map(c => c.x).sort((a, b) => a - b);
    const yVals = j1.map(c => c.y).sort((a, b) => a - b);
    expect(xVals).toEqual([1, 1, 1, 2]); // vertical bar at x=1, flag at x=2
    expect(yVals).toEqual([0, 0, 1, 2]); // flag at top (y=0), bar spans rows 0-2
    expect(j1.some(c => c.x === 2 && c.y === 0)).toBe(true); // flag cell = (2,0)
  });

  it("J and L are mirror images: mirror(J1) = L3, mirror(L1) = J3", () => {
    const mirrorX = (cells: readonly { x: number; y: number }[]) =>
      cells.map(c => ({ x: 2 - c.x, y: c.y })).sort((a, b) => a.x - b.x || a.y - b.y);

    const j1 = PIECES.J[1]!;
    const l3 = PIECES.L[3]!;
    expect(mirrorX(j1)).toEqual([...l3].sort((a, b) => a.x - b.x || a.y - b.y));

    const l1 = PIECES.L[1]!;
    const j3 = PIECES.J[3]!;
    expect(mirrorX(l1)).toEqual([...j3].sort((a, b) => a.x - b.x || a.y - b.y));
  });

  it("CW rotation advances J through all 4 rotation states", () => {
    const state = createPlayerState(42);
    state.queue = ["J", ...state.queue];
    applyInputAction(state, "hardDrop");
    finalizeAfterLock(state);

    expect(state.active!.type).toBe("J");
    const initial = state.active!.rotation;

    applyInputAction(state, "rotateCW");
    expect(state.active!.rotation).toBe((initial + 1) % 4);

    applyInputAction(state, "rotateCW");
    expect(state.active!.rotation).toBe((initial + 2) % 4);

    applyInputAction(state, "rotateCW");
    expect(state.active!.rotation).toBe((initial + 3) % 4);

    applyInputAction(state, "rotateCW");
    expect(state.active!.rotation).toBe(initial); // full cycle
  });

  it("all 7 piece types have exactly 4 rotations of 4 cells each", () => {
    const types = ["I", "J", "L", "O", "S", "T", "Z"] as const;
    for (const type of types) {
      expect(PIECES[type]).toHaveLength(4);
      for (let r = 0; r < 4; r++) {
        expect(PIECES[type][r]).toHaveLength(4);
      }
    }
  });
});
