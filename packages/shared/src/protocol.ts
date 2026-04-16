import type {
  InputAction,
  JoinQueuePayload,
  LobbySnapshot,
  MatchFoundPayload,
  MatchResultPayload,
  MatchSnapshot
} from "./types.js";

export const LOBBY_MESSAGES = {
  joinQueue: "queue:join",
  leaveQueue: "queue:leave",
  queueStatus: "queue:status",
  matchFound: "match:found",
  leaderboard: "leaderboard:update"
} as const;

export const MATCH_MESSAGES = {
  input: "game:input",
  snapshot: "game:snapshot",
  result: "game:result",
  error: "game:error"
} as const;

export interface QueueStatusPayload {
  inQueue: boolean;
  queueSize: number;
}

export interface MatchInputPayload {
  action: InputAction;
}

export type LobbyMessagePayloads = {
  [LOBBY_MESSAGES.joinQueue]: JoinQueuePayload;
  [LOBBY_MESSAGES.queueStatus]: QueueStatusPayload;
  [LOBBY_MESSAGES.matchFound]: MatchFoundPayload;
  [LOBBY_MESSAGES.leaderboard]: LobbySnapshot;
};

export type MatchMessagePayloads = {
  [MATCH_MESSAGES.input]: MatchInputPayload;
  [MATCH_MESSAGES.snapshot]: MatchSnapshot;
  [MATCH_MESSAGES.result]: MatchResultPayload;
  [MATCH_MESSAGES.error]: { message: string };
};
