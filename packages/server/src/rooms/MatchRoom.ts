import { Client, Room } from "@colyseus/core";
import {
  DISCONNECT_FORFEIT_DELAY_MS,
  MATCH_MESSAGES,
  type InputAction,
  type MatchInputPayload
} from "@tetris-arena/shared";
import { MatchSimulation } from "../game/matchSimulation.js";
import { leaderboardService } from "../services/leaderboard.js";
import { lobbyService } from "../services/lobby.js";

interface PendingPlayer {
  id: string;
  nickname: string;
}

export class MatchRoom extends Room {
  override maxClients = 2;
  private readonly players: PendingPlayer[] = [];
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private simulation: MatchSimulation | null = null;
  private persistenceDone = false;

  override onCreate(): void {
    this.onMessage(MATCH_MESSAGES.input, (client, payload: MatchInputPayload) => {
      this.handleInput(client.sessionId, payload.action);
    });

    this.setPatchRate(null);
    this.setSimulationInterval((deltaMs) => {
      this.tick(deltaMs);
    }, 33);
  }

  override onJoin(client: Client, options: { nickname?: string }): void {
    const nickname = options.nickname?.trim() || `Player ${this.clients.length}`;
    this.players.push({
      id: client.sessionId,
      nickname
    });

    if (this.players.length === 2) {
      this.lock();
      this.simulation = new MatchSimulation(this.roomId, this.players);
      this.broadcastSnapshots();
    }
  }

  override onLeave(client: Client): void {
    if (!this.simulation || this.simulation.isFinished) {
      return;
    }

    const timeout = setTimeout(() => {
      this.simulation?.forfeit(client.sessionId);
      this.broadcastSnapshots();
      this.finishIfNeeded().catch(() => undefined);
    }, DISCONNECT_FORFEIT_DELAY_MS);

    this.disconnectTimers.set(client.sessionId, timeout);
  }

  override onDispose(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
  }

  private handleInput(playerId: string, action: InputAction): void {
    if (!this.simulation || this.simulation.isFinished) {
      return;
    }
    this.simulation.enqueueInput(playerId, action);
  }

  private tick(deltaMs: number): void {
    if (!this.simulation) {
      return;
    }

    const result = this.simulation.tick(deltaMs);
    this.broadcastSnapshots();

    if (result) {
      this.broadcast(MATCH_MESSAGES.result, result);
      this.disconnect();
      return;
    }

    this.finishIfNeeded().catch(() => undefined);
  }

  private broadcastSnapshots(): void {
    if (!this.simulation) {
      return;
    }

    for (const client of this.clients) {
      client.send(MATCH_MESSAGES.snapshot, this.simulation.getSnapshot(client.sessionId));
    }
  }

  private async finishIfNeeded(): Promise<void> {
    if (!this.simulation || !this.simulation.isFinished || this.persistenceDone) {
      return;
    }

    this.persistenceDone = true;
    const result = this.simulation.getWinnerAndLoserResults();
    if (result) {
      await leaderboardService.recordMatch(
        result.winnerNickname,
        result.loserNickname,
        result.winnerScore,
        result.loserScore
      );
      lobbyService.onMatchEnd();
      await lobbyService.broadcastLobbySnapshot();
    }
  }
}
