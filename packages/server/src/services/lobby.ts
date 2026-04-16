import { matchMaker } from "@colyseus/core";
import {
  LOBBY_MESSAGES,
  type LobbySnapshot,
  type MatchFoundPayload,
  type QueueStatusPayload,
  type SeatReservation
} from "@tetris-arena/shared";
import { leaderboardService } from "./leaderboard.js";

interface LobbyClient {
  sessionId: string;
  nickname: string;
  sendQueueStatus(payload: QueueStatusPayload): void;
  sendMatchFound(payload: MatchFoundPayload): void;
  sendLobbySnapshot(payload: LobbySnapshot): void;
}

export class LobbyService {
  private readonly clients = new Map<string, LobbyClient>();
  private readonly queue: string[] = [];

  register(client: LobbyClient): void {
    this.clients.set(client.sessionId, client);
  }

  unregister(sessionId: string): void {
    this.leaveQueue(sessionId);
    this.clients.delete(sessionId);
  }

  async getSnapshot(): Promise<LobbySnapshot> {
    return {
      leaderboard: await leaderboardService.getTop(),
      queueSize: this.queue.length
    };
  }

  async broadcastLobbySnapshot(): Promise<void> {
    const snapshot = await this.getSnapshot();
    for (const client of this.clients.values()) {
      client.sendLobbySnapshot(snapshot);
    }
  }

  async joinQueue(sessionId: string, nickname: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return;
    }

    client.nickname = nickname.trim();
    if (!this.queue.includes(sessionId)) {
      this.queue.push(sessionId);
    }

    await this.sendQueueUpdates();
    await this.maybeCreateMatch();
  }

  leaveQueue(sessionId: string): void {
    const index = this.queue.indexOf(sessionId);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
    this.sendQueueUpdates().catch(() => undefined);
  }

  private async maybeCreateMatch(): Promise<void> {
    while (this.queue.length >= 2) {
      const firstId = this.queue.shift()!;
      const secondId = this.queue.shift()!;
      const first = this.clients.get(firstId);
      const second = this.clients.get(secondId);

      if (!first || !second) {
        continue;
      }

      const room = await matchMaker.createRoom("match", {});
      const firstReservation = (await matchMaker.reserveSeatFor(room, {
        nickname: first.nickname
      })) as SeatReservation;
      const secondReservation = (await matchMaker.reserveSeatFor(room, {
        nickname: second.nickname
      })) as SeatReservation;

      first.sendQueueStatus({ inQueue: false, queueSize: this.queue.length });
      second.sendQueueStatus({ inQueue: false, queueSize: this.queue.length });
      first.sendMatchFound({ reservation: firstReservation });
      second.sendMatchFound({ reservation: secondReservation });
    }

    await this.sendQueueUpdates();
  }

  private async sendQueueUpdates(): Promise<void> {
    const queueSet = new Set(this.queue);
    const snapshot = await this.getSnapshot();

    for (const client of this.clients.values()) {
      client.sendQueueStatus({
        inQueue: queueSet.has(client.sessionId),
        queueSize: this.queue.length
      });
      client.sendLobbySnapshot(snapshot);
    }
  }
}

export const lobbyService = new LobbyService();
