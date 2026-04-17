export type PieceType = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
export type CellValue = PieceType | "garbage" | null;

export type InputAction =
  | "moveLeft"
  | "moveRight"
  | "rotateCW"
  | "rotateCCW"
  | "softDrop"
  | "hardDrop"
  | "hold";

export interface ActivePiece {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
}

export interface ScoringEvent {
  id: number;
  points: number;
  dropPoints: number;
  clearPoints: number;
  comboBonus: number;
  backToBackBonus: number;
  level: number;
  linesCleared: number;
  combo: number;
  qualifiesBackToBack: boolean;
  isTSpin: boolean;
  label: string | null;
}

export interface BoardSnapshot {
  board: CellValue[][];
  active: ActivePiece | null;
  hold: PieceType | null;
  queue: PieceType[];
  canHold: boolean;
  combo: number;
  backToBack: boolean;
  pendingGarbage: number;
  linesClearedTotal: number;
  garbageSentTotal: number;
  score: number;
  level: number;
  piecesLocked: number;
  lastScoringEvent: ScoringEvent | null;
  isTopOut: boolean;
}

export interface PlayerSnapshot extends BoardSnapshot {
  playerId: string;
  nickname: string;
}

export interface MatchSnapshot {
  matchId: string;
  status: "countdown" | "playing" | "finished";
  winnerId: string | null;
  loserId: string | null;
  you: PlayerSnapshot;
  opponent: PlayerSnapshot;
  countdownMs: number;
  message: string | null;
}

export interface LeaderboardEntry {
  nickname: string;
  bestScore: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  updatedAt: string;
}

export interface LobbySnapshot {
  leaderboard: LeaderboardEntry[];
  queueSize: number;
  connectedPlayers: number;
  activeGames: number;
  gamesPlayedSinceStart: number;
  avgWaitMs: number;
}

export interface JoinQueuePayload {
  nickname: string;
}

export interface SeatReservation {
  name: string;
  sessionId: string;
  roomId: string;
  publicAddress?: string;
  processId?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

export interface MatchFoundPayload {
  reservation: SeatReservation;
}

export interface MatchResultPayload {
  winnerId: string;
  loserId: string;
  winnerNickname: string;
  winnerScore: number;
  loserScore: number;
}

export interface GameplayResolution {
  locked: boolean;
  linesCleared: number;
  attackSent: number;
  topOut: boolean;
}

export interface InternalPlayerState {
  board: CellValue[][];
  active: ActivePiece | null;
  hold: PieceType | null;
  canHold: boolean;
  queue: PieceType[];
  bag: PieceType[];
  combo: number;
  backToBack: boolean;
  pendingGarbage: number;
  rngState: number;
  gravityTimerMs: number;
  lockTimerMs: number;
  lockResets: number;
  linesClearedTotal: number;
  garbageSentTotal: number;
  score: number;
  piecesLocked: number;
  scoringEventId: number;
  lastScoringEvent: ScoringEvent | null;
  isTopOut: boolean;
  needsSpawn: boolean;
  lastResolution: GameplayResolution | null;
}
