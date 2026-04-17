import {
  MATCH_RESULT_DELAY_MS,
  applyInputAction,
  cancelPendingGarbage,
  createPlayerState,
  enqueueGarbage,
  finalizeAfterLock,
  getBoardSnapshot,
  tickPlayerState,
  type InputAction,
  type InternalPlayerState,
  type MatchSnapshot,
  type MatchResultPayload,
  type PlayerSnapshot
} from "@tetris-arena/shared";

const DISAMBIG_WORDS = [
  "Alpha", "Bravo", "Delta", "Echo", "Foxtrot",
  "Golf", "Kilo", "Lima", "Mike", "Nova",
  "Oscar", "Papa", "Romeo", "Sierra", "Tango",
  "Uniform", "Victor", "Whiskey", "Xray", "Yankee"
];

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h || 1;
}

function disambiguateWord(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return DISAMBIG_WORDS[h % DISAMBIG_WORDS.length]!;
}

interface SimPlayer {
  id: string;
  nickname: string;
  state: InternalPlayerState;
}

export class MatchSimulation {
  private readonly players: SimPlayer[];
  private readonly actionQueue = new Map<string, InputAction[]>();
  private countdownMs = 3000;
  private resultDelayMs = MATCH_RESULT_DELAY_MS;
  private winnerId: string | null = null;
  private loserId: string | null = null;
  private finished = false;

  constructor(matchId: string, participants: Array<{ id: string; nickname: string }>) {
    this.matchId = matchId;
    this.players = participants.map((player, index) => ({
      id: player.id,
      nickname: player.nickname,
      state: createPlayerState(hashSeed(`${matchId}:${index}`))
    }));
  }

  readonly matchId: string;

  get isFinished(): boolean {
    return this.finished;
  }

  enqueueInput(playerId: string, action: InputAction): void {
    const actions = this.actionQueue.get(playerId) ?? [];
    actions.push(action);
    this.actionQueue.set(playerId, actions);
  }

  forfeit(playerId: string): void {
    if (this.finished) {
      return;
    }

    const loser = this.players.find((player) => player.id === playerId);
    const winner = this.players.find((player) => player.id !== playerId);
    if (!loser || !winner) {
      return;
    }

    loser.state.isTopOut = true;
    this.finish(winner.id, loser.id);
  }

  tick(deltaMs: number): MatchResultPayload | null {
    if (this.finished) {
      this.resultDelayMs -= deltaMs;
      return this.resultDelayMs <= 0 ? this.getResultPayload() : null;
    }

    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - deltaMs);
      return null;
    }

    const resolutions = new Map<string, { attackSent: number; locked: boolean }>();

    for (const player of this.players) {
      const inputs = this.actionQueue.get(player.id) ?? [];
      this.actionQueue.set(player.id, []);

      for (const action of inputs) {
        const resolution = applyInputAction(player.state, action);
        if (resolution) {
          resolutions.set(player.id, resolution);
          break;
        }
      }
    }

    for (const player of this.players) {
      if (resolutions.has(player.id)) {
        continue;
      }

      const resolution = tickPlayerState(player.state, deltaMs);
      if (resolution) {
        resolutions.set(player.id, resolution);
      }
    }

    this.resolveCombat(resolutions);
    this.resolveOutcome();
    return null;
  }

  getSnapshot(forPlayerId: string): MatchSnapshot {
    const you = this.players.find((player) => player.id === forPlayerId) ?? this.players[0]!;
    const opponent = this.players.find((player) => player.id !== you.id) ?? this.players[1]!;

    const youSnap = this.toSnapshot(you);
    const opponentSnap = this.toSnapshot(opponent);

    // Shadow workaround: when both players share the same callsign (case-insensitive),
    // suffix the opponent's display name so each player can distinguish themselves.
    if (youSnap.nickname.toLowerCase() === opponentSnap.nickname.toLowerCase()) {
      opponentSnap.nickname = `${opponentSnap.nickname} - ${disambiguateWord(opponent.id)}`;
    }

    return {
      matchId: this.matchId,
      status: this.finished ? "finished" : this.countdownMs > 0 ? "countdown" : "playing",
      winnerId: this.winnerId,
      loserId: this.loserId,
      you: youSnap,
      opponent: opponentSnap,
      countdownMs: this.countdownMs,
      message: this.finished
        ? `${this.players.find((player) => player.id === this.winnerId)?.nickname ?? "Winner"} wins`
        : this.countdownMs > 0
          ? `Match starts in ${Math.ceil(this.countdownMs / 1000)}`
          : null
    };
  }

  getResultPayload(): MatchResultPayload {
    const winner = this.players.find((player) => player.id === this.winnerId) ?? this.players[0]!;
    const loser = this.players.find((player) => player.id === this.loserId) ?? this.players[1] ?? winner;
    return {
      winnerId: winner.id,
      loserId: this.loserId ?? "",
      winnerNickname: winner.nickname,
      winnerScore: winner.state.score,
      loserScore: loser.state.score
    };
  }

  getWinnerAndLoserResults(): { winnerNickname: string; loserNickname: string; winnerScore: number; loserScore: number } | null {
    if (!this.winnerId || !this.loserId) {
      return null;
    }

    const winner = this.players.find((player) => player.id === this.winnerId);
    const loser = this.players.find((player) => player.id === this.loserId);
    if (!winner || !loser) {
      return null;
    }

    return {
      winnerNickname: winner.nickname,
      loserNickname: loser.nickname,
      winnerScore: winner.state.score,
      loserScore: loser.state.score
    };
  }

  private resolveCombat(resolutions: Map<string, { attackSent: number; locked: boolean }>): void {
    const [first, second] = this.getPair();
    const firstResolution = resolutions.get(first.id);
    const secondResolution = resolutions.get(second.id);

    let attackFirst = firstResolution?.attackSent ?? 0;
    let attackSecond = secondResolution?.attackSent ?? 0;

    const duelCancel = Math.min(attackFirst, attackSecond);
    attackFirst -= duelCancel;
    attackSecond -= duelCancel;

    attackFirst = cancelPendingGarbage(first.state, attackFirst);
    attackSecond = cancelPendingGarbage(second.state, attackSecond);

    if (attackFirst > 0) {
      enqueueGarbage(second.state, attackFirst);
    }
    if (attackSecond > 0) {
      enqueueGarbage(first.state, attackSecond);
    }

    if (firstResolution?.locked) {
      finalizeAfterLock(first.state);
    }
    if (secondResolution?.locked) {
      finalizeAfterLock(second.state);
    }
  }

  private resolveOutcome(): void {
    if (this.finished) {
      return;
    }

    const [first, second] = this.getPair();
    if (!first.state.isTopOut && !second.state.isTopOut) {
      return;
    }

    if (first.state.isTopOut && second.state.isTopOut) {
      const firstScore = first.state.score;
      const secondScore = second.state.score;
      if (firstScore >= secondScore) {
        this.finish(first.id, second.id);
      } else {
        this.finish(second.id, first.id);
      }
      return;
    }

    if (first.state.isTopOut) {
      this.finish(second.id, first.id);
    } else {
      this.finish(first.id, second.id);
    }
  }

  private finish(winnerId: string, loserId: string): void {
    this.finished = true;
    this.winnerId = winnerId;
    this.loserId = loserId;
  }

  private getPair(): [SimPlayer, SimPlayer] {
    const [first, second] = this.players;
    if (!first || !second) {
      throw new Error("MatchSimulation requires exactly two players.");
    }
    return [first, second];
  }

  private toSnapshot(player: SimPlayer): PlayerSnapshot {
    return {
      playerId: player.id,
      nickname: player.nickname,
      ...getBoardSnapshot(player.state)
    };
  }
}
