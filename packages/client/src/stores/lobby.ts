import { writable } from 'svelte/store';
import type { LeaderboardEntry, QueueStatusPayload, LobbySnapshot } from '@tetris-arena/shared';

export const lobbyConnected = writable(false);
export const leaderboard = writable<LeaderboardEntry[]>([]);
export const queueStatus = writable<QueueStatusPayload>({ inQueue: false, queueSize: 0 });
export const connectedPlayers = writable(0);
export const activeGames = writable(0);
export const gamesPlayedSinceStart = writable(0);
export const avgWaitMs = writable(0);
export const ping = writable<number | null>(null);
export const lobbyError = writable<string | null>(null);

export function applyLobbySnapshot(snap: LobbySnapshot): void {
  leaderboard.set(snap.leaderboard);
  connectedPlayers.set(snap.connectedPlayers);
  activeGames.set(snap.activeGames);
  gamesPlayedSinceStart.set(snap.gamesPlayedSinceStart);
  avgWaitMs.set(snap.avgWaitMs);
  queueStatus.update(s => ({ ...s, queueSize: snap.queueSize }));
}
