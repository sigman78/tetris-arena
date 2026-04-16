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
  getBoardSnapshot
} from "../src/index.js";

describe("shared engine", () => {
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
});
