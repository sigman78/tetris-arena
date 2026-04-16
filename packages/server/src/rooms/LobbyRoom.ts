import { Client, Room } from "@colyseus/core";
import {
  LOBBY_MESSAGES,
  type JoinQueuePayload,
  type LobbySnapshot,
  type MatchFoundPayload,
  type QueueStatusPayload
} from "@tetris-arena/shared";
import { lobbyService } from "../services/lobby.js";

export class LobbyRoom extends Room {
  override maxClients = 200;

  override async onCreate(): Promise<void> {
    this.onMessage(LOBBY_MESSAGES.joinQueue, async (client, payload: JoinQueuePayload) => {
      await lobbyService.joinQueue(client.sessionId, payload.nickname);
    });

    this.onMessage(LOBBY_MESSAGES.leaveQueue, (client) => {
      lobbyService.leaveQueue(client.sessionId);
    });
  }

  override async onJoin(client: Client): Promise<void> {
    const snapshot = await lobbyService.getSnapshot();
    lobbyService.register({
      sessionId: client.sessionId,
      nickname: "",
      sendQueueStatus: (payload: QueueStatusPayload) => {
        client.send(LOBBY_MESSAGES.queueStatus, payload);
      },
      sendMatchFound: (payload: MatchFoundPayload) => {
        client.send(LOBBY_MESSAGES.matchFound, payload);
      },
      sendLobbySnapshot: (payload: LobbySnapshot) => {
        client.send(LOBBY_MESSAGES.leaderboard, payload);
      }
    });

    client.send(LOBBY_MESSAGES.leaderboard, snapshot);
    client.send(LOBBY_MESSAGES.queueStatus, { inQueue: false, queueSize: snapshot.queueSize });
  }

  override onLeave(client: Client): void {
    lobbyService.unregister(client.sessionId);
  }
}
