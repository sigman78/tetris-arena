import { Client, type Room } from "@colyseus/sdk";
import { writable, get } from "svelte/store";
import { LOBBY_MESSAGES, MATCH_MESSAGES } from "@tetris-arena/shared";
import type {
  InputAction,
  MatchFoundPayload,
  QueueStatusPayload,
  LobbySnapshot,
  MatchSnapshot,
  MatchResultPayload,
} from "@tetris-arena/shared";
import { view } from "../stores/app.js";
import {
  queueStatus,
  ping,
  lobbyError,
  applyLobbySnapshot,
} from "../stores/lobby.js";
import { matchSnapshot, matchResult, resetMatch } from "../stores/match.js";

// ── WS client ─────────────────────────────────────────────────
const wsBase =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:2567`;

const client = new Client(wsBase);

// ── Module-level room refs ────────────────────────────────────
let lobbyRoom: Room | null = null;
let matchRoom: Room | null = null;

// ── Exported store: queue join time (for elapsed wait display) ─
export const queueJoinTime = writable<number | null>(null);

// ── Ping interval handle ──────────────────────────────────────
let pingInterval: ReturnType<typeof setInterval> | null = null;

// ─────────────────────────────────────────────────────────────
// connectLobby
// ─────────────────────────────────────────────────────────────
export async function connectLobby(): Promise<void> {
  if (lobbyRoom) return;

  const room = await client.joinOrCreate("lobby");
  lobbyRoom = room;

  // Queue status updates
  room.onMessage(LOBBY_MESSAGES.queueStatus, (payload: QueueStatusPayload) => {
    const wasInQueue = get(queueStatus).inQueue;
    queueStatus.set(payload);
    if (payload.inQueue && !wasInQueue) queueJoinTime.set(performance.now());
    if (!payload.inQueue) queueJoinTime.set(null);
  });

  // Lobby snapshot (leaderboard + server stats)
  room.onMessage(LOBBY_MESSAGES.leaderboard, (payload: LobbySnapshot) => {
    applyLobbySnapshot(payload);
  });

  // Ping loop using Colyseus built-in
  const doPing = (): void => {
    room.ping((latency: number) => {
      ping.set(latency);
    });
  };
  doPing();
  pingInterval = setInterval(doPing, 5000);

  // Match found: leave lobby and join match
  room.onMessage(
    LOBBY_MESSAGES.matchFound,
    async (payload: MatchFoundPayload) => {
      lobbyError.set(null);
      queueStatus.update((s) => ({ ...s, inQueue: false }));
      queueJoinTime.set(null);

      await room.leave();
      lobbyRoom = null;

      await connectMatch(payload);
    }
  );

  // Lobby leave cleanup
  room.onLeave(() => {
    lobbyRoom = null;
    if (pingInterval !== null) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    ping.set(null);
  });
}

// ─────────────────────────────────────────────────────────────
// connectMatch  (called internally from matchFound handler)
// ─────────────────────────────────────────────────────────────
async function connectMatch(payload: MatchFoundPayload): Promise<void> {
  view.set("match");
  resetMatch();

  const room = await client.consumeSeatReservation(payload.reservation);
  matchRoom = room;

  room.onMessage(MATCH_MESSAGES.snapshot, (snapshot: MatchSnapshot) => {
    matchSnapshot.set(snapshot);
  });

  room.onMessage(MATCH_MESSAGES.result, (result: MatchResultPayload) => {
    matchResult.set(result);
  });

  room.onMessage(MATCH_MESSAGES.error, (payload: { message: string }) => {
    lobbyError.set(payload.message);
  });

  room.onLeave(async () => {
    matchRoom = null;
    view.set("lobby");
    resetMatch();
    try {
      await connectLobby();
    } catch (err) {
      lobbyError.set(err instanceof Error ? err.message : "Reconnection failed.");
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Action API
// ─────────────────────────────────────────────────────────────
export function sendJoinQueue(nickname: string): void {
  lobbyRoom?.send(LOBBY_MESSAGES.joinQueue, { nickname });
}

export function sendLeaveQueue(): void {
  lobbyRoom?.send(LOBBY_MESSAGES.leaveQueue);
}

export function sendMatchInput(action: InputAction): void {
  matchRoom?.send(MATCH_MESSAGES.input, { action });
}

export function disconnectLobby(): void {
  lobbyRoom?.leave().catch(() => { /* intentional disconnect */ });
  lobbyRoom = null;
}
