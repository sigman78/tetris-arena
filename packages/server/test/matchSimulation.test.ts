import { describe, expect, it } from "vitest";
import { MatchSimulation } from "../src/game/matchSimulation.js";

describe("MatchSimulation", () => {
  it("creates opponent snapshots for each player", () => {
    const simulation = new MatchSimulation("room-1", [
      { id: "a", nickname: "Alice" },
      { id: "b", nickname: "Bob" }
    ]);

    const snapshot = simulation.getSnapshot("a");
    expect(snapshot.you.nickname).toBe("Alice");
    expect(snapshot.opponent.nickname).toBe("Bob");
    expect(snapshot.status).toBe("countdown");
  });

  it("forfeit resolves winner", () => {
    const simulation = new MatchSimulation("room-2", [
      { id: "a", nickname: "Alice" },
      { id: "b", nickname: "Bob" }
    ]);

    simulation.forfeit("a");
    expect(simulation.isFinished).toBe(true);
    expect(simulation.getResultPayload().winnerId).toBe("b");
  });
});
