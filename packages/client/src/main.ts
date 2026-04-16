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
let matchStartTime = 0;
const banners: BannerEntry[] = [];
const scoreBursts: ScoreBurst[] = [];
const scoreTickRafs = new Map<string, number>();

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
    pushBanner("CHALLENGER", "Match found", "start", 2800);
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
  pushBanner("ROUND 1", "Entering arena", "start", 2800);
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
      5000
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
  const medals = ["🥇", "🥈", "🥉"];
  const rows = state.leaderboard.length > 0
    ? state.leaderboard.map((entry, index) => {
        const losses = entry.gamesPlayed - entry.wins;
        const winPct = entry.gamesPlayed > 0 ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0;
        const pctColor = winPct >= 60 ? `color:var(--accent)` : winPct <= 35 && entry.gamesPlayed > 0 ? `color:var(--danger)` : "";
        const isMe = entry.nickname === state.nickname.trim();
        const rank = index < 3 ? medals[index] : String(index + 1);
        return `
          <tr class="${isMe ? "leaderboard-me" : ""}">
            <td>${rank}</td>
            <td>${escapeHtml(entry.nickname)}</td>
            <td class="stat-value" style="font-size:0.9rem">${formatScore(entry.bestScore)}</td>
            <td>${entry.wins}</td>
            <td>${losses}</td>
            <td style="${pctColor}">${entry.gamesPlayed > 0 ? `${winPct}%` : "—"}</td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="6" class="muted" style="text-align:center;padding:1.5rem 0">No matches recorded yet.</td></tr>`;

  return `
    <main class="shell">
      <section class="hero">

        <div class="panel stack">
          <div class="lobby-brand">
            <p class="stat-label" style="margin:0 0 0.35rem">ONLINE PVP · KEYBOARD</p>
            <h1 class="title">Tetris<br>Arena</h1>
            <p class="muted" style="margin-top:0.35rem">Clear lines, pressure your opponent, survive the garbage war.</p>
          </div>

          <div class="stack lobby-setup">
            <div class="stat-label">CALLSIGN</div>
            <input id="nickname" maxlength="18" placeholder="Enter your nickname…" value="${escapeHtml(state.nickname)}" />
          </div>

          <div class="stack" style="gap:0.55rem">
            <div class="row">
              <button id="queue-btn" ${state.queueStatus.inQueue || !state.lobbyRoom ? "disabled" : ""}>${state.queueStatus.inQueue ? "SEARCHING…" : "Find Match"}</button>
              <button id="leave-btn" class="secondary" ${state.queueStatus.inQueue ? "" : "disabled"}>Leave</button>
            </div>
            <div class="status-pill ${state.error ? "error" : state.queueStatus.inQueue ? "queueing" : ""}">
              ${state.error
                ? `<span>${escapeHtml(state.error)}</span><button id="retry-btn" class="secondary" style="padding:0.2rem 0.7rem;font-size:0.72rem;margin-left:0.5rem">Retry</button>`
                : state.queueStatus.inQueue
                  ? `<span class="queue-radar"><span></span><span></span><span></span></span><span>Scanning for rival…</span>`
                  : "Ready — enter your callsign and join"}
            </div>
          </div>

          <div class="lobby-meta">
            <div>
              <div class="stat-label">PLAYERS WAITING</div>
              <div class="stat-value">${state.queueStatus.queueSize}</div>
            </div>
            <div class="lobby-keys">
              <div class="stat-label" style="margin-bottom:0.4rem">CONTROLS</div>
              <div class="controls">
                <span>Move ←→</span>
                <span>Rotate X / Z</span>
                <span>Soft drop ↓</span>
                <span>Hard drop Space</span>
                <span>Hold Shift / C</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="lobby-records-header">
            <div>
              <h2 class="lobby-records-title">Arena Records</h2>
              <p class="muted" style="margin:0.15rem 0 0">Ranked by best match score</p>
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
            <tbody>${rows}</tbody>
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

        <div class="players-bar panel">
          <div class="player-pill">
            <div class="player-pill-name" id="local-name">You</div>
            <div class="player-pill-live"><span class="live-dot"></span>LIVE</div>
            <div id="local-b2b" class="b2b-badge"></div>
          </div>
          <div class="players-bar-center">
            <div class="players-bar-vs">VS</div>
          </div>
          <div class="player-pill player-pill--right">
            <div id="opponent-b2b" class="b2b-badge"></div>
            <div class="player-pill-name" id="opponent-name">Opponent</div>
          </div>
        </div>

        <div id="announcer-stack" class="announcer-stack"></div>
        <div id="result-screen" class="result-screen" hidden></div>

        <div class="arena">

          <aside class="arena-stats">
            <div class="stat-item">
              <div class="stat-label">LINES</div>
              <div class="stat-value" id="local-lines">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">LEVEL</div>
              <div class="stat-value" id="local-level">1</div>
            </div>
            <div class="stat-item stat-item--score">
              <div class="stat-label">SCORE</div>
              <div class="stat-value" id="local-score">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">COMBO</div>
              <div class="stat-value" id="local-combo">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">SENT</div>
              <div class="stat-value" id="local-attack">0</div>
            </div>
          </aside>

          <div class="board-col">
            <div id="local-pending" class="pending-strip"></div>
            <div class="canvas-wrap">
              <canvas id="local-board"></canvas>
              <div id="local-bursts" class="score-bursts score-bursts-local"></div>
              <div id="match-overlay" class="overlay" hidden></div>
            </div>
          </div>

          <div class="arena-center">
            <div id="local-hold-slot"></div>
            <div id="local-next-slot"></div>
            <div class="center-sep"></div>
            <div class="center-trash">
              <div class="stat-label">INCOMING</div>
              <div id="local-pending-n" class="trash-n">—</div>
              <div class="trash-arrows-icon">⇵</div>
              <div id="opponent-pending-n" class="trash-n muted">—</div>
              <div class="stat-label">SENDING</div>
            </div>
          </div>

          <div class="board-col">
            <div id="opponent-pending" class="pending-strip pending-strip--right"></div>
            <div class="canvas-wrap canvas-wrap--sm">
              <canvas id="opponent-board"></canvas>
              <div id="opponent-bursts" class="score-bursts score-bursts-opponent"></div>
            </div>
          </div>

          <aside class="arena-stats arena-stats--right">
            <div class="stat-item">
              <div class="stat-label">LINES</div>
              <div class="stat-value muted" id="opponent-lines">0</div>
            </div>
            <div class="stat-item stat-item--score">
              <div class="stat-label">SCORE</div>
              <div class="stat-value" id="opponent-score">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">COMBO</div>
              <div class="stat-value muted" id="opponent-combo">—</div>
            </div>
          </aside>

        </div>

        <div class="match-footer panel">
          <div class="match-time-block">
            <span class="stat-label">TIME</span>
            <span id="match-time-val" class="match-time-val">0:00</span>
          </div>
          <div class="hud">
            <span><strong>Move</strong> ←→↓</span>
            <span><strong>Rotate</strong> X / Z</span>
            <span><strong>Drop</strong> Space</span>
            <span><strong>Hold</strong> Shift / C</span>
          </div>
        </div>

      </section>
    </main>
  `;
}

function tickScoreTo(el: HTMLElement, target: number): void {
  const id = el.id;
  const currentTarget = Number(el.dataset.scoreTo ?? "0");

  if (currentTarget === target) {
    return;
  }

  const fromValue = Number(el.dataset.scoreFrom ?? "0");
  // Snap displayed value as the new start
  el.dataset.scoreFrom = String(fromValue);
  el.dataset.scoreTo = String(target);

  const existingRaf = scoreTickRafs.get(id);
  if (existingRaf !== undefined) {
    window.cancelAnimationFrame(existingRaf);
  }

  const startTime = performance.now();
  const duration = 450;

  const tick = (now: number): void => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const from = Number(el.dataset.scoreFrom ?? "0");
    const to = Number(el.dataset.scoreTo ?? "0");
    const displayed = Math.round(from + (to - from) * progress);
    el.textContent = formatScore(displayed);

    if (progress < 1) {
      scoreTickRafs.set(id, window.requestAnimationFrame(tick));
    } else {
      el.dataset.scoreFrom = String(target);
      scoreTickRafs.delete(id);
    }
  };

  scoreTickRafs.set(id, window.requestAnimationFrame(tick));
}

function updateMatchView(): void {
  if (state.view !== "match") {
    return;
  }

  const snapshot = state.currentMatch;
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
  const localAttack = document.querySelector<HTMLElement>("#local-attack");
  const opponentScore = document.querySelector<HTMLElement>("#opponent-score");
  const localHold = document.querySelector<HTMLElement>("#local-hold-slot");
  const localNext = document.querySelector<HTMLElement>("#local-next-slot");
  // Optional elements (no null guard)
  const opponentLines = document.querySelector<HTMLElement>("#opponent-lines");
  const opponentCombo = document.querySelector<HTMLElement>("#opponent-combo");
  const localPendingN = document.querySelector<HTMLElement>("#local-pending-n");
  const opponentPendingN = document.querySelector<HTMLElement>("#opponent-pending-n");
  const matchTimeEl = document.querySelector<HTMLElement>("#match-time-val");

  if (
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
    !localAttack ||
    !opponentScore ||
    !localHold ||
    !localNext
  ) {
    return;
  }

  // Result screen
  if (state.result) {
    const result = state.result;
    const isVictory = snapshot ? result.winnerId === snapshot.you.playerId : false;
    const loserNickname = snapshot
      ? (isVictory ? snapshot.opponent.nickname : snapshot.you.nickname)
      : "Opponent";
    const particleColors = ["#49dcb1", "#a1ffce", "#59a9ff", "#ffe45c", "#ff5d73"];
    const particles = isVictory
      ? Array.from({ length: 12 }, (_, i) => {
          const tx = Math.round((Math.random() - 0.5) * 240);
          const ty = Math.round(-80 - Math.random() * 120);
          const delay = (Math.random() * 0.35).toFixed(2);
          const color = particleColors[i % particleColors.length]!;
          return `<span class="result-particle" style="--tx:${tx}px;--ty:${ty}px;--delay:${delay}s;--color:${color}"></span>`;
        }).join("")
      : "";

    resultScreen.hidden = false;
    resultScreen.className = `result-screen result-screen--${isVictory ? "victory" : "defeat"}`;
    resultScreen.innerHTML = `
      ${particles}
      <div class="result-card${isVictory ? "" : " result-card--defeat"}">
        <div class="result-heading ${isVictory ? "tone-victory" : "tone-danger"}">${isVictory ? "VICTORY" : "DEFEAT"}</div>
        <div class="result-scores">
          <div class="result-score-item">
            <span class="result-score-label">${escapeHtml(result.winnerNickname)}</span>
            <span class="result-score-value">${formatScore(result.winnerScore)}</span>
          </div>
          <div class="result-score-item">
            <span class="result-score-label">${escapeHtml(loserNickname)}</span>
            <span class="result-score-value muted">${formatScore(result.loserScore)}</span>
          </div>
        </div>
        <p class="muted result-note">Returning to lobby…</p>
      </div>
    `;
  } else {
    resultScreen.hidden = true;
    resultScreen.className = "result-screen";
  }

  if (!snapshot) {
    overlay.hidden = false;
    overlay.innerHTML = "CONNECTING";
    localHold.innerHTML = renderPiecePreview("Hold", null);
    localNext.innerHTML = renderPiecePreview("Next", null);
    renderAnnouncements();
    return;
  }

  localName.textContent = snapshot.you.nickname;
  opponentName.textContent = snapshot.opponent.nickname;
  localB2b.textContent = snapshot.you.backToBack ? "B2B" : "";
  localB2b.classList.toggle("active", snapshot.you.backToBack);
  opponentB2b.textContent = snapshot.opponent.backToBack ? "B2B" : "";
  opponentB2b.classList.toggle("active", snapshot.opponent.backToBack);

  const localPendingVal = snapshot.you.pendingGarbage;
  localPending.textContent = localPendingVal > 0 ? `⚠ ${localPendingVal} incoming` : "";
  localPending.classList.toggle("pending-strip--active", localPendingVal > 0);

  const opponentPendingVal = snapshot.opponent.pendingGarbage;
  opponentPending.textContent = opponentPendingVal > 0 ? `⚠ ${opponentPendingVal} incoming` : "";
  opponentPending.classList.toggle("pending-strip--active", opponentPendingVal > 0);

  if (localPendingN) localPendingN.textContent = localPendingVal > 0 ? String(localPendingVal) : "—";
  if (opponentPendingN) opponentPendingN.textContent = opponentPendingVal > 0 ? String(opponentPendingVal) : "—";

  tickScoreTo(localScore, snapshot.you.score);
  localLevel.textContent = String(snapshot.you.level);
  localLines.textContent = String(snapshot.you.linesClearedTotal);
  localCombo.textContent = snapshot.you.combo > 1 ? `${snapshot.you.combo}×` : "—";
  localAttack.textContent = String(snapshot.you.garbageSentTotal);

  tickScoreTo(opponentScore, snapshot.opponent.score);
  if (opponentLines) opponentLines.textContent = String(snapshot.opponent.linesClearedTotal);
  if (opponentCombo) opponentCombo.textContent = snapshot.opponent.combo > 1 ? `${snapshot.opponent.combo}×` : "—";

  localHold.innerHTML = renderPiecePreview("Hold", snapshot.you.hold, !snapshot.you.canHold);
  localNext.innerHTML = renderPiecePreview("Next", snapshot.you.queue[0] ?? null);

  overlay.hidden = snapshot.status !== "countdown" || !snapshot.message;
  overlay.innerHTML = snapshot.status === "countdown" && snapshot.message ? escapeHtml(snapshot.message.toUpperCase()) : "";

  if (matchTimeEl && matchStartTime > 0 && snapshot.status === "playing") {
    const elapsed = Math.floor((performance.now() - matchStartTime) / 1000);
    matchTimeEl.textContent = formatMatchTime(elapsed);
  }

  drawBoards();
  renderAnnouncements();
}

function processSnapshotTransitions(snapshot: MatchSnapshot): void {
  if (!previousSnapshot) {
    pushBanner("ROUND 1", `${snapshot.you.nickname} VS ${snapshot.opponent.nickname}`, "start", 2800);
  }

  if (previousSnapshot?.status === "countdown" && snapshot.countdownMs <= 2000 && previousSnapshot.countdownMs > 2000) {
    pushBanner("READY", "Set your stack", "start", 2200);
  }

  if (previousSnapshot?.status === "countdown" && snapshot.status === "playing") {
    matchStartTime = performance.now();
    pushBanner("FIGHT", "Stack and survive", "start", 2400);
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

  document.querySelector("#retry-btn")?.addEventListener("click", () => {
    state.error = null;
    render();
    void connectLobby().catch((err) => {
      state.error = err instanceof Error ? err.message : "Connection failed.";
      render();
    });
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
    pushBanner(event.label ?? "SCORE", `+${event.points} POINTS`, "score", 2200);
  }
}

function resetAnnouncements(): void {
  banners.length = 0;
  scoreBursts.length = 0;
  previousSnapshot = null;
  seenLocalScoreEventId = 0;
  seenOpponentScoreEventId = 0;
  matchStartTime = 0;
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

function formatMatchTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
