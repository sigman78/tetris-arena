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

describe("callsign collision — shadow workaround", () => {
  it("does not modify nicknames when they differ", () => {
    const sim = new MatchSimulation("r1", [
      { id: "a", nickname: "Alice" },
      { id: "b", nickname: "Bob" }
    ]);
    const snap = sim.getSnapshot("a");
    expect(snap.you.nickname).toBe("Alice");
    expect(snap.opponent.nickname).toBe("Bob");
  });

  it("leaves 'you' nickname unchanged on collision", () => {
    const sim = new MatchSimulation("r2", [
      { id: "a", nickname: "Neo" },
      { id: "b", nickname: "Neo" }
    ]);
    expect(sim.getSnapshot("a").you.nickname).toBe("Neo");
    expect(sim.getSnapshot("b").you.nickname).toBe("Neo");
  });

  it("suffixes opponent nickname on exact callsign collision", () => {
    const sim = new MatchSimulation("r3", [
      { id: "a", nickname: "Neo" },
      { id: "b", nickname: "Neo" }
    ]);
    const snapA = sim.getSnapshot("a");
    const snapB = sim.getSnapshot("b");
    expect(snapA.opponent.nickname).toMatch(/^Neo - \w+$/);
    expect(snapB.opponent.nickname).toMatch(/^Neo - \w+$/);
  });

  it("treats collision as case-insensitive", () => {
    const sim = new MatchSimulation("r4", [
      { id: "a", nickname: "alice" },
      { id: "b", nickname: "ALICE" }
    ]);
    // Both perspectives should see the opponent suffixed
    expect(sim.getSnapshot("a").opponent.nickname).toMatch(/^ALICE - \w+$/);
    expect(sim.getSnapshot("b").opponent.nickname).toMatch(/^alice - \w+$/);
  });

  it("produces the same disambiguation word for the same player ID across matches", () => {
    const sim1 = new MatchSimulation("r5", [
      { id: "sess-xyz-111", nickname: "Clash" },
      { id: "sess-abc-222", nickname: "Clash" }
    ]);
    const sim2 = new MatchSimulation("r6", [
      { id: "sess-xyz-111", nickname: "Clash" },
      { id: "sess-abc-222", nickname: "Clash" }
    ]);
    expect(sim1.getSnapshot("sess-xyz-111").opponent.nickname)
      .toBe(sim2.getSnapshot("sess-xyz-111").opponent.nickname);
    expect(sim1.getSnapshot("sess-abc-222").opponent.nickname)
      .toBe(sim2.getSnapshot("sess-abc-222").opponent.nickname);
  });

  it("result payload preserves original (unmodified) nicknames", () => {
    const sim = new MatchSimulation("r7", [
      { id: "a", nickname: "Clash" },
      { id: "b", nickname: "Clash" }
    ]);
    sim.forfeit("b");
    const result = sim.getResultPayload();
    expect(result.winnerNickname).toBe("Clash");
  });
});
