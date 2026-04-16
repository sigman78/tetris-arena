import { Client, Room } from "colyseus.js";
import {
  LOBBY_MESSAGES,
  MATCH_MESSAGES,
  type InputAction,
  type LeaderboardEntry,
  type LobbySnapshot,
  type MatchFoundPayload,
  type MatchResultPayload,
  type MatchSnapshot,
  type ScoringEvent,
  type SeatReservation,
  type QueueStatusPayload
} from "@tetris-arena/shared";
import { createBoardRenderState, drawBoard, renderPiecePreview } from "./renderer.js";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root");
}
const appRoot = app;

const httpBase = import.meta.env.VITE_SERVER_HTTP_URL ?? `${window.location.protocol}//${window.location.hostname}:2567`;
const wsBase =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:2567`;
const colyseusClient = new Client(wsBase);
const storageKey = "tetris-arena:nickname";

type ViewState = "lobby" | "match";
type BannerTone = "neutral" | "start" | "danger" | "victory" | "score";
type BurstSide = "local" | "opponent";

type LegacySeatReservation = {
  room: {
    name: string;
    roomId: string;
    processId?: string;
    publicAddress?: string;
  };
  sessionId: string;
  protocol?: string;
  reconnectionToken?: string;
  devMode?: boolean;
};

type BannerEntry = {
  id: number;
  title: string;
  subtitle?: string;
  tone: BannerTone;
  expiresAt: number;
  fadingOut?: boolean;
};

type ScoreBurst = {
  id: number;
  side: BurstSide;
  title: string;
  points: number;
  bonus?: string;
  expiresAt: number;
};

const state = {
  view: "lobby" as ViewState,
  nickname: window.localStorage.getItem(storageKey) ?? "",
  lobbyRoom: null as Room | null,
  matchRoom: null as Room | null,
  leaderboard: [] as LeaderboardEntry[],
  queueStatus: {
    inQueue: false,
    queueSize: 0
  },
  currentMatch: null as MatchSnapshot | null,
  result: null as MatchResultPayload | null,
  error: null as string | null
};

const localRendererState = createBoardRenderState();
const opponentRendererState = createBoardRenderState();

let renderedView: ViewState | null = null;
let matchAnimationFrame = 0;
let previousSnapshot: MatchSnapshot | null = null;
let seenLocalScoreEventId = 0;
let seenOpponentScoreEventId = 0;
let announcementId = 0;
const banners: BannerEntry[] = [];
const scoreBursts: ScoreBurst[] = [];

render();
void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    await refreshLeaderboard();
    await connectLobby();
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Failed to start client.";
  }
  render();
}

async function refreshLeaderboard(): Promise<void> {
  const response = await fetch(`${httpBase}/leaderboard`);
  if (!response.ok) {
    throw new Error(`Leaderboard request failed (${response.status}).`);
  }
  state.leaderboard = (await response.json()) as LeaderboardEntry[];
}

async function connectLobby(): Promise<void> {
  if (state.lobbyRoom) {
    return;
  }

  const reservation = await requestSeatReservation("lobby");
  const room = await colyseusClient.consumeSeatReservation(reservation as never);
  state.lobbyRoom = room;

  room.onMessage(LOBBY_MESSAGES.queueStatus, (payload: QueueStatusPayload) => {
    state.queueStatus = payload;
    render();
  });

  room.onMessage(LOBBY_MESSAGES.leaderboard, (payload: LobbySnapshot) => {
    state.leaderboard = payload.leaderboard;
    state.queueStatus.queueSize = payload.queueSize;
    render();
  });

  room.onMessage(LOBBY_MESSAGES.matchFound, async (payload: MatchFoundPayload) => {
    state.error = null;
    state.queueStatus.inQueue = false;
    resetAnnouncements();
    pushBanner("CHALLENGER", "Match found", "start", 1200);
    render();
    await room.leave();
    state.lobbyRoom = null;
    await connectMatch(payload);
  });

  room.onLeave(() => {
    state.lobbyRoom = null;
  });
}

async function connectMatch(payload: MatchFoundPayload): Promise<void> {
  state.view = "match";
  state.currentMatch = null;
  state.result = null;
  state.error = null;
  resetAnnouncements();
  pushBanner("ROUND 1", "Entering arena", "start", 1200);
  render();

  const room = await colyseusClient.consumeSeatReservation(normalizeSeatReservation(payload.reservation) as never);
  state.matchRoom = room;

  room.onMessage(MATCH_MESSAGES.snapshot, (snapshot: MatchSnapshot) => {
    processSnapshotTransitions(snapshot);
    state.currentMatch = snapshot;
    updateMatchView();
  });

  room.onMessage(MATCH_MESSAGES.result, (result: MatchResultPayload) => {
    state.result = result;
    pushBanner(
      result.winnerId === state.currentMatch?.you.playerId ? "VICTORY" : "DEFEAT",
      `${result.winnerNickname} ${result.winnerId === state.currentMatch?.you.playerId ? "falls to you" : "takes the match"}`,
      result.winnerId === state.currentMatch?.you.playerId ? "victory" : "danger",
      2800
    );
    updateMatchView();
  });

  room.onMessage(MATCH_MESSAGES.error, (payload: { message: string }) => {
    state.error = payload.message;
    pushBanner("ERROR", payload.message, "danger", 2400);
    updateMatchView();
  });

  room.onLeave(async () => {
    state.matchRoom = null;
    state.currentMatch = null;
    state.result = null;
    state.error = null;
    state.view = "lobby";
    previousSnapshot = null;
    resetAnnouncements();
    await refreshLeaderboard();
    await connectLobby();
    render();
  });
}

function render(): void {
  if (state.view === "lobby") {
    stopMatchRenderLoop();
    renderedView = "lobby";
    appRoot.innerHTML = renderLobby();
    window.onkeydown = null;
    bindLobbyActions();
    return;
  }

  if (renderedView !== "match") {
    appRoot.innerHTML = renderMatch();
    renderedView = "match";
  }

  bindMatchActions();
  updateMatchView();
  startMatchRenderLoop();
}

function renderLobby(): string {
  return `
    <main class="shell">
      <section class="hero">
        <div class="panel stack">
          <div>
            <p class="subtitle">Browser PvP survival Tetris</p>
            <h1 class="title">Tetris Arena</h1>
            <p class="muted">Clear lines, pressure your opponent, and survive the garbage war.</p>
          </div>
          <label class="stack">
            <span>Handle</span>
            <input id="nickname" maxlength="18" placeholder="Enter your nickname" value="${escapeHtml(state.nickname)}" />
          </label>
          <div class="row">
            <button id="queue-btn" ${state.queueStatus.inQueue ? "disabled" : ""}>${state.queueStatus.inQueue ? "SEARCHING" : "Join Queue"}</button>
            <button id="leave-btn" class="secondary" ${state.queueStatus.inQueue ? "" : "disabled"}>Leave Queue</button>
          </div>
          <div class="status-pill ${state.error ? "error" : state.queueStatus.inQueue ? "queueing" : ""}">
            ${
              state.error
                ? escapeHtml(state.error)
                : state.queueStatus.inQueue
                  ? `<span class="queue-radar"><span></span><span></span><span></span></span><span>Scanning for rival</span>`
                  : "Ready for the public queue"
            }
          </div>
          <div class="hud">
            <span><strong>${state.queueStatus.queueSize}</strong> players waiting</span>
            <span><strong>Desktop</strong> keyboard controls</span>
          </div>
          <div class="controls">
            <span>Move: Arrow keys</span>
            <span>Rotate: X / Z</span>
            <span>Soft drop: Arrow down</span>
            <span>Hard drop: Space</span>
            <span>Hold: Shift / C</span>
          </div>
        </div>
        <div class="panel">
          <div class="row" style="justify-content: space-between;">
            <div>
              <h2 style="margin: 0;">Arena Records</h2>
              <p class="muted">Ranked by best match score</p>
            </div>
            <div class="status-pill">Top ${state.leaderboard.length}</div>
          </div>
          <table class="leaderboard">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Score</th>
                <th>W</th>
                <th>L</th>
                <th>Win%</th>
              </tr>
            </thead>
            <tbody>
              ${
                state.leaderboard.length > 0
                  ? state.leaderboard
                      .map(
                        (entry, index) => {
                          const losses = entry.gamesPlayed - entry.wins;
                          const winPct = entry.gamesPlayed > 0 ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0;
                          const pctColor = winPct >= 60 ? `color:var(--accent)` : winPct <= 35 && entry.gamesPlayed > 0 ? `color:var(--danger)` : "";
                          return `
                          <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(entry.nickname)}</td>
                            <td>${formatScore(entry.bestScore)}</td>
                            <td>${entry.wins}</td>
                            <td>${losses}</td>
                            <td style="${pctColor}">${entry.gamesPlayed > 0 ? `${winPct}%` : "—"}</td>
                          </tr>
                        `;
                        }
                      )
                      .join("")
                  : `<tr><td colspan="6" class="muted">No matches recorded yet.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `;
}

function renderMatch(): string {
  return `
    <main class="shell match-shell">
      <section class="game">
        <div class="panel game-header">
          <div>
            <p class="subtitle">Match Arena</p>
            <h2 id="match-title" style="margin: 0;">Connecting...</h2>
          </div>
          <div class="hud">
            <span><strong>Hold</strong> Shift / C</span>
            <span><strong>Drop</strong> Space</span>
          </div>
        </div>
        <div id="announcer-stack" class="announcer-stack"></div>
        <div id="result-screen" class="result-screen" hidden></div>
        <div class="boards">
          <article class="panel board-card">
            <div class="board-meta">
              <div>
                <strong id="local-name">You</strong>
                <div class="muted">Your board</div>
              </div>
              <div id="local-b2b" class="b2b-badge"></div>
              <div id="local-pending" class="muted"></div>
            </div>
            <div class="board-stage">
              <div class="canvas-wrap">
                <canvas id="local-board"></canvas>
                <div id="local-bursts" class="score-bursts score-bursts-local"></div>
                <div id="match-overlay" class="overlay" hidden></div>
              </div>
              <aside class="piece-rail">
                <div id="local-hold-slot"></div>
                <div id="local-next-slot"></div>
              </aside>
            </div>
            <div class="hud board-stats">
              <span><strong>Score</strong> <span id="local-score">0</span></span>
              <span><strong>Level</strong> <span id="local-level">1</span></span>
              <span><strong>Lines</strong> <span id="local-lines">0</span></span>
              <span><strong>Combo</strong> <span id="local-combo">0</span></span>
              <span><strong>Attack</strong> <span id="local-attack">0</span></span>
            </div>
          </article>
          <article class="panel board-card">
            <div class="board-meta">
              <div>
                <strong id="opponent-name">Opponent</strong>
                <div class="muted">Pressure meter</div>
              </div>
              <div id="opponent-b2b" class="b2b-badge"></div>
              <div id="opponent-pending" class="muted"></div>
            </div>
            <div class="board-stage">
              <div class="canvas-wrap">
                <canvas id="opponent-board"></canvas>
                <div id="opponent-bursts" class="score-bursts score-bursts-opponent"></div>
              </div>
              <aside class="piece-rail">
                <div id="opponent-hold-slot"></div>
                <div id="opponent-next-slot"></div>
              </aside>
            </div>
            <div class="hud board-stats">
              <span><strong>Score</strong> <span id="opponent-score">0</span></span>
              <span><strong>Level</strong> <span id="opponent-level">1</span></span>
              <span><strong>Lines</strong> <span id="opponent-lines">0</span></span>
              <span><strong>Combo</strong> <span id="opponent-combo">0</span></span>
              <span><strong>Attack</strong> <span id="opponent-attack">0</span></span>
            </div>
          </article>
        </div>
      </section>
    </main>
  `;
}

function updateMatchView(): void {
  if (state.view !== "match") {
    return;
  }

  const snapshot = state.currentMatch;
  const title = document.querySelector<HTMLElement>("#match-title");
  const overlay = document.querySelector<HTMLElement>("#match-overlay");
  const resultScreen = document.querySelector<HTMLElement>("#result-screen");
  const localName = document.querySelector<HTMLElement>("#local-name");
  const opponentName = document.querySelector<HTMLElement>("#opponent-name");
  const localB2b = document.querySelector<HTMLElement>("#local-b2b");
  const opponentB2b = document.querySelector<HTMLElement>("#opponent-b2b");
  const localPending = document.querySelector<HTMLElement>("#local-pending");
  const opponentPending = document.querySelector<HTMLElement>("#opponent-pending");
  const localScore = document.querySelector<HTMLElement>("#local-score");
  const localLevel = document.querySelector<HTMLElement>("#local-level");
  const localLines = document.querySelector<HTMLElement>("#local-lines");
  const localCombo = document.querySelector<HTMLElement>("#local-combo");
  const opponentScore = document.querySelector<HTMLElement>("#opponent-score");
  const opponentLevel = document.querySelector<HTMLElement>("#opponent-level");
  const opponentLines = document.querySelector<HTMLElement>("#opponent-lines");
  const opponentCombo = document.querySelector<HTMLElement>("#opponent-combo");
  const localHold = document.querySelector<HTMLElement>("#local-hold-slot");
  const localNext = document.querySelector<HTMLElement>("#local-next-slot");
  const opponentHold = document.querySelector<HTMLElement>("#opponent-hold-slot");
  const opponentNext = document.querySelector<HTMLElement>("#opponent-next-slot");
  const localAttack = document.querySelector<HTMLElement>("#local-attack");
  const opponentAttack = document.querySelector<HTMLElement>("#opponent-attack");

  if (
    !title ||
    !overlay ||
    !resultScreen ||
    !localName ||
    !opponentName ||
    !localB2b ||
    !opponentB2b ||
    !localPending ||
    !opponentPending ||
    !localScore ||
    !localLevel ||
    !localLines ||
    !localCombo ||
    !opponentScore ||
    !opponentLevel ||
    !opponentLines ||
    !opponentCombo ||
    !localHold ||
    !localNext ||
    !opponentHold ||
    !opponentNext ||
    !localAttack ||
    !opponentAttack
  ) {
    return;
  }

  // Show result screen when match ends
  if (state.result) {
    const result = state.result;
    const isVictory = snapshot ? result.winnerId === snapshot.you.playerId : false;
    resultScreen.hidden = false;
    resultScreen.innerHTML = `
      <div class="result-card">
        <div class="result-heading ${isVictory ? "tone-victory" : "tone-danger"}">${isVictory ? "VICTORY" : "DEFEAT"}</div>
        <div class="result-winner">${escapeHtml(result.winnerNickname)}</div>
        <div class="result-scores">
          <div class="result-score-item">
            <span class="result-score-label">${escapeHtml(result.winnerNickname)}</span>
            <span class="result-score-value">${formatScore(result.winnerScore)}</span>
          </div>
          <div class="result-score-item">
            <span class="result-score-label muted">Opponent</span>
            <span class="result-score-value muted">${formatScore(result.loserScore)}</span>
          </div>
        </div>
        <p class="muted result-note">Returning to lobby…</p>
      </div>
    `;
  } else {
    resultScreen.hidden = true;
  }

  if (!snapshot) {
    title.textContent = "Connecting...";
    overlay.hidden = false;
    overlay.innerHTML = "CONNECTING";
    localHold.innerHTML = renderPiecePreview("Hold", null);
    localNext.innerHTML = renderPiecePreview("Next", null);
    opponentHold.innerHTML = renderPiecePreview("Hold", null);
    opponentNext.innerHTML = renderPiecePreview("Next", null);
    renderAnnouncements();
    return;
  }

  title.textContent = `${snapshot.you.nickname} vs ${snapshot.opponent.nickname}`;
  localName.textContent = snapshot.you.nickname;
  opponentName.textContent = snapshot.opponent.nickname;
  localB2b.textContent = snapshot.you.backToBack ? "B2B" : "";
  localB2b.classList.toggle("active", snapshot.you.backToBack);
  opponentB2b.textContent = snapshot.opponent.backToBack ? "B2B" : "";
  opponentB2b.classList.toggle("active", snapshot.opponent.backToBack);
  localPending.textContent = `Pending garbage ${snapshot.you.pendingGarbage}`;
  opponentPending.textContent = `Pending garbage ${snapshot.opponent.pendingGarbage}`;
  localScore.textContent = formatScore(snapshot.you.score);
  localLevel.textContent = String(snapshot.you.level);
  localLines.textContent = String(snapshot.you.linesClearedTotal);
  localCombo.textContent = String(snapshot.you.combo);
  opponentScore.textContent = formatScore(snapshot.opponent.score);
  opponentLevel.textContent = String(snapshot.opponent.level);
  opponentLines.textContent = String(snapshot.opponent.linesClearedTotal);
  opponentCombo.textContent = String(snapshot.opponent.combo);
  localAttack.textContent = String(snapshot.you.garbageSentTotal);
  opponentAttack.textContent = String(snapshot.opponent.garbageSentTotal);
  localHold.innerHTML = renderPiecePreview("Hold", snapshot.you.hold, !snapshot.you.canHold);
  localNext.innerHTML = renderPiecePreview("Next", snapshot.you.queue[0] ?? null);
  opponentHold.innerHTML = renderPiecePreview("Hold", snapshot.opponent.hold, !snapshot.opponent.canHold);
  opponentNext.innerHTML = renderPiecePreview("Next", snapshot.opponent.queue[0] ?? null);

  overlay.hidden = snapshot.status !== "countdown" || !snapshot.message;
  overlay.innerHTML = snapshot.status === "countdown" && snapshot.message ? escapeHtml(snapshot.message.toUpperCase()) : "";

  drawBoards();
  renderAnnouncements();
}

function processSnapshotTransitions(snapshot: MatchSnapshot): void {
  if (!previousSnapshot) {
    pushBanner("ROUND 1", `${snapshot.you.nickname} VS ${snapshot.opponent.nickname}`, "start", 1200);
  }

  if (previousSnapshot?.status === "countdown" && snapshot.countdownMs <= 2000 && previousSnapshot.countdownMs > 2000) {
    pushBanner("READY", "Set your stack", "start", 1000);
  }

  if (previousSnapshot?.status === "countdown" && snapshot.status === "playing") {
    pushBanner("FIGHT", "Stack and survive", "start", 1100);
  }

  // Countdown second-boundary pops
  if (snapshot.status === "countdown" && previousSnapshot) {
    const prevSec = Math.ceil(previousSnapshot.countdownMs / 1000);
    const curSec = Math.ceil(snapshot.countdownMs / 1000);
    if (curSec !== prevSec && curSec > 0) {
      triggerCountdownPop();
    }
  }

  if (snapshot.you.lastScoringEvent && snapshot.you.lastScoringEvent.id > seenLocalScoreEventId) {
    seenLocalScoreEventId = snapshot.you.lastScoringEvent.id;
    pushScoreBurst("local", snapshot.you.lastScoringEvent);
  }

  if (snapshot.opponent.lastScoringEvent && snapshot.opponent.lastScoringEvent.id > seenOpponentScoreEventId) {
    seenOpponentScoreEventId = snapshot.opponent.lastScoringEvent.id;
    pushScoreBurst("opponent", snapshot.opponent.lastScoringEvent);
  }

  previousSnapshot = snapshot;
}

function triggerCountdownPop(): void {
  const overlay = document.querySelector<HTMLElement>("#match-overlay");
  if (!overlay) return;
  overlay.classList.remove("countdown-pop");
  // Force reflow so removing/re-adding the class restarts the animation
  void overlay.offsetWidth;
  overlay.classList.add("countdown-pop");
}

function bindLobbyActions(): void {
  const nicknameInput = document.querySelector<HTMLInputElement>("#nickname");
  const queueButton = document.querySelector<HTMLButtonElement>("#queue-btn");
  const leaveButton = document.querySelector<HTMLButtonElement>("#leave-btn");

  nicknameInput?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    state.nickname = target.value;
    window.localStorage.setItem(storageKey, state.nickname);
  });

  queueButton?.addEventListener("click", () => {
    const nickname = state.nickname.trim();
    if (!nickname) {
      state.error = "Choose a handle before joining the queue.";
      render();
      return;
    }

    state.error = null;
    state.lobbyRoom?.send(LOBBY_MESSAGES.joinQueue, { nickname });
  });

  leaveButton?.addEventListener("click", () => {
    state.lobbyRoom?.send(LOBBY_MESSAGES.leaveQueue);
  });
}

function bindMatchActions(): void {
  window.onkeydown = (event: KeyboardEvent) => {
    const action = mapKeyToAction(event);
    if (!action || !state.matchRoom) {
      return;
    }

    if ((action === "hardDrop" || action === "hold") && event.repeat) {
      return;
    }

    event.preventDefault();
    state.matchRoom.send(MATCH_MESSAGES.input, { action });
  };
}

function startMatchRenderLoop(): void {
  if (matchAnimationFrame !== 0) {
    return;
  }

  const frame = () => {
    if (state.view !== "match") {
      matchAnimationFrame = 0;
      return;
    }

    drawBoards();
    renderAnnouncements();
    matchAnimationFrame = window.requestAnimationFrame(frame);
  };

  matchAnimationFrame = window.requestAnimationFrame(frame);
}

function stopMatchRenderLoop(): void {
  if (matchAnimationFrame !== 0) {
    window.cancelAnimationFrame(matchAnimationFrame);
    matchAnimationFrame = 0;
  }
}

function drawBoards(): void {
  if (!state.currentMatch) {
    return;
  }

  const localCanvas = document.querySelector<HTMLCanvasElement>("#local-board");
  const opponentCanvas = document.querySelector<HTMLCanvasElement>("#opponent-board");
  if (!localCanvas || !opponentCanvas) {
    return;
  }

  drawBoard(localCanvas, state.currentMatch.you, localRendererState);
  drawBoard(opponentCanvas, state.currentMatch.opponent, opponentRendererState);
}

function renderAnnouncements(): void {
  const now = performance.now();
  pruneExpired(now);

  const announcer = document.querySelector<HTMLElement>("#announcer-stack");
  if (announcer) {
    announcer.innerHTML = banners
      .map(
        (banner) => `
          <div class="announcer-banner tone-${banner.tone}${banner.fadingOut ? " fading" : ""}">
            <div class="announcer-title">${escapeHtml(banner.title)}</div>
            ${banner.subtitle ? `<div class="announcer-subtitle">${escapeHtml(banner.subtitle)}</div>` : ""}
          </div>
        `
      )
      .join("");
  }

  for (const side of ["local", "opponent"] as const) {
    const container = document.querySelector<HTMLElement>(`#${side}-bursts`);
    if (!container) {
      continue;
    }

    container.innerHTML = scoreBursts
      .filter((burst) => burst.side === side)
      .map(
        (burst) => `
          <div class="score-burst">
            <div class="score-burst-title">${escapeHtml(burst.title)}</div>
            <div class="score-burst-points">+${formatScore(burst.points)}</div>
            ${burst.bonus ? `<div class="score-burst-bonus">${escapeHtml(burst.bonus)}</div>` : ""}
          </div>
        `
      )
      .join("");
  }
}

function pruneExpired(now: number): void {
  for (let index = banners.length - 1; index >= 0; index -= 1) {
    const banner = banners[index]!;
    if (banner.expiresAt <= now) {
      if (!banner.fadingOut) {
        banner.fadingOut = true;
        banner.expiresAt = now + 280;
      } else {
        banners.splice(index, 1);
      }
    }
  }

  for (let index = scoreBursts.length - 1; index >= 0; index -= 1) {
    if (scoreBursts[index]!.expiresAt <= now) {
      scoreBursts.splice(index, 1);
    }
  }
}

function pushBanner(title: string, subtitle: string | undefined, tone: BannerTone, durationMs: number): void {
  const now = performance.now();
  banners.push({
    id: ++announcementId,
    title,
    tone,
    expiresAt: now + durationMs,
    ...(subtitle ? { subtitle } : {})
  });
}

function pushScoreBurst(side: BurstSide, event: ScoringEvent): void {
  const bonusParts: string[] = [];
  if (event.comboBonus > 0) {
    bonusParts.push(`COMBO +${event.comboBonus}`);
  }
  if (event.backToBackBonus > 0) {
    bonusParts.push(`B2B +${event.backToBackBonus}`);
  }
  if (event.linesCleared === 0) {
    bonusParts.push(`DROP +${event.dropPoints}`);
  }

  scoreBursts.push({
    id: ++announcementId,
    side,
    title: event.label ?? `LEVEL ${event.level}`,
    points: event.points,
    expiresAt: performance.now() + 1700,
    ...(bonusParts.length > 0 ? { bonus: bonusParts.join(" • ") } : {})
  });

  if (side === "local" && (event.linesCleared >= 2 || event.comboBonus > 0 || event.backToBackBonus > 0)) {
    pushBanner(event.label ?? "SCORE", `+${event.points} POINTS`, "score", 1100);
  }
}

function resetAnnouncements(): void {
  banners.length = 0;
  scoreBursts.length = 0;
  previousSnapshot = null;
  seenLocalScoreEventId = 0;
  seenOpponentScoreEventId = 0;
}

function mapKeyToAction(event: KeyboardEvent): InputAction | null {
  switch (event.key) {
    case "ArrowLeft":
      return "moveLeft";
    case "ArrowRight":
      return "moveRight";
    case "ArrowDown":
      return "softDrop";
    case " ":
      return "hardDrop";
    case "x":
    case "X":
    case "ArrowUp":
      return "rotateCW";
    case "z":
    case "Z":
      return "rotateCCW";
    case "Shift":
    case "c":
    case "C":
      return "hold";
    default:
      return null;
  }
}

async function requestSeatReservation(roomName: string, options: Record<string, unknown> = {}): Promise<LegacySeatReservation> {
  const response = await fetch(`${httpBase}/matchmake/joinOrCreate/${roomName}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(options)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Matchmaking request failed (${response.status}).`;
    throw new Error(message);
  }

  return normalizeSeatReservation(payload);
}

function normalizeSeatReservation(reservation: unknown): LegacySeatReservation {
  if (!reservation || typeof reservation !== "object") {
    throw new Error("Invalid match reservation received from server.");
  }

  if ("room" in reservation && reservation.room && typeof reservation.room === "object") {
    const room = reservation.room as Record<string, unknown>;
    if (
      typeof room.name === "string" &&
      typeof room.roomId === "string" &&
      "sessionId" in reservation &&
      typeof reservation.sessionId === "string"
    ) {
      return reservation as LegacySeatReservation;
    }
  }

  const flat = reservation as SeatReservation & { protocol?: string };
  if (
    typeof flat.name !== "string" ||
    typeof flat.roomId !== "string" ||
    typeof flat.sessionId !== "string"
  ) {
    throw new Error("Match reservation is missing required fields.");
  }

  return {
    room: {
      name: flat.name,
      roomId: flat.roomId,
      ...(flat.processId ? { processId: flat.processId } : {}),
      ...(flat.publicAddress ? { publicAddress: flat.publicAddress } : {})
    },
    sessionId: flat.sessionId,
    ...(flat.protocol ? { protocol: flat.protocol } : {}),
    ...(flat.reconnectionToken ? { reconnectionToken: flat.reconnectionToken } : {}),
    ...(flat.devMode !== undefined ? { devMode: flat.devMode } : {})
  };
}

function formatScore(value: number): string {
  return value.toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
