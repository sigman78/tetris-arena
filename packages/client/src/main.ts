import { Client, Room } from "@colyseus/sdk";
import {
  LOBBY_MESSAGES,
  MATCH_MESSAGES,
  PIECES,
  type InputAction,
  type LeaderboardEntry,
  type LobbySnapshot,
  type MatchFoundPayload,
  type MatchResultPayload,
  type ScoringEvent,
  type QueueStatusPayload,
  type MatchSnapshot,
  type PieceType
} from "@tetris-arena/shared";
import { BoardRenderer } from "./pixi/BoardRenderer.js";
import { NEON_COLORS } from "./pixi/cellTextures.js";
import { BannerStack, type BannerTone } from "./components/BannerStack.js";
import "./styles.css";

// ── Config ────────────────────────────────────────────────────
const appRootEl = document.querySelector<HTMLDivElement>("#app");
if (!appRootEl) throw new Error("Missing #app root");
const appRoot = appRootEl;

const httpBase =
  import.meta.env.VITE_SERVER_HTTP_URL ??
  `${window.location.protocol}//${window.location.hostname}:2567`;
const wsBase =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:2567`;
const colyseusClient = new Client(wsBase);
const storageKey = "tetris-arena:nickname";

// ── Types ─────────────────────────────────────────────────────
type ViewState = "lobby" | "match";
type BurstSide = "local" | "opponent";

// ── App state ─────────────────────────────────────────────────
const state = {
  view: "lobby" as ViewState,
  nickname: window.localStorage.getItem(storageKey) ?? "",
  lobbyRoom: null as Room | null,
  matchRoom: null as Room | null,
  leaderboard: [] as LeaderboardEntry[],
  queueStatus: { inQueue: false, queueSize: 0 },
  lobbySnapshot: null as LobbySnapshot | null,
  queueJoinTime: null as number | null,
  queueTickInterval: null as ReturnType<typeof setInterval> | null,
  pingMs: null as number | null,
  pingInterval: null as ReturnType<typeof setInterval> | null,
  currentMatch: null as MatchSnapshot | null,
  result: null as MatchResultPayload | null,
  error: null as string | null
};

// ── Match component refs ──────────────────────────────────────
let renderedView: ViewState | null = null;
let localBoardRenderer: BoardRenderer | null = null;
let opponentBoardRenderer: BoardRenderer | null = null;
let bannerStack: BannerStack | null = null;
let matchAnimationFrame = 0;
let previousSnapshot: MatchSnapshot | null = null;
let seenLocalScoreEventId = 0;
let seenOpponentScoreEventId = 0;
let announcementId = 0;
let matchStartTime = 0;

// ── Bootstrap ─────────────────────────────────────────────────
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
  if (!response.ok) throw new Error(`Leaderboard request failed (${response.status}).`);
  state.leaderboard = (await response.json()) as LeaderboardEntry[];
}

async function connectLobby(): Promise<void> {
  if (state.lobbyRoom) return;

  const room = await colyseusClient.joinOrCreate("lobby");
  state.lobbyRoom = room;

  room.onMessage(LOBBY_MESSAGES.queueStatus, (payload: QueueStatusPayload) => {
    const wasInQueue = state.queueStatus.inQueue;
    state.queueStatus = payload;
    if (payload.inQueue && !wasInQueue) {
      state.queueJoinTime = performance.now();
      state.queueTickInterval = setInterval(() => {
        if (state.queueStatus.inQueue) render();
        else {
          clearInterval(state.queueTickInterval!);
          state.queueTickInterval = null;
        }
      }, 1000);
    }
    if (!payload.inQueue) {
      state.queueJoinTime = null;
    }
    render();
  });

  room.onMessage(LOBBY_MESSAGES.leaderboard, (payload: LobbySnapshot) => {
    state.leaderboard = payload.leaderboard;
    state.queueStatus.queueSize = payload.queueSize;
    state.lobbySnapshot = payload;
    render();
  });

  const doPing = (): void => {
    room.ping((latency) => {
      state.pingMs = latency;
      render();
    });
  };
  doPing();
  state.pingInterval = setInterval(doPing, 5000);

  room.onMessage(LOBBY_MESSAGES.matchFound, async (payload: MatchFoundPayload) => {
    state.error = null;
    state.queueStatus.inQueue = false;
    resetMatchState();
    render();
    await room.leave();
    state.lobbyRoom = null;
    await connectMatch(payload);
  });

  room.onLeave(() => {
    state.lobbyRoom = null;
    if (state.pingInterval !== null) {
      clearInterval(state.pingInterval);
      state.pingInterval = null;
    }
    state.pingMs = null;
  });
}

async function connectMatch(payload: MatchFoundPayload): Promise<void> {
  state.view = "match";
  state.currentMatch = null;
  state.result = null;
  state.error = null;
  resetMatchState();
  render();

  const room = await colyseusClient.consumeSeatReservation(payload.reservation);
  state.matchRoom = room;

  room.onMessage(MATCH_MESSAGES.snapshot, (snapshot: MatchSnapshot) => {
    processSnapshotTransitions(snapshot);
    state.currentMatch = snapshot;
    updateMatchView();
  });

  room.onMessage(MATCH_MESSAGES.result, (result: MatchResultPayload) => {
    state.result = result;
    const isWin = result.winnerId === state.currentMatch?.you.playerId;
    pushBanner(
      isWin ? "VICTORY" : "DEFEAT",
      `${result.winnerNickname} ${isWin ? "falls to you" : "takes the match"}`,
      isWin ? "victory" : "danger",
      3500,
      true
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
    resetMatchState();
    await refreshLeaderboard();
    await connectLobby();
    render();
  });
}

// ── View switching ────────────────────────────────────────────
function render(): void {
  if (state.view === "lobby") {
    stopMatchRenderLoop();
    destroyMatchComponents();
    renderedView = "lobby";
    appRoot.innerHTML = renderLobby();
    window.onkeydown = null;
    bindLobbyActions();
    return;
  }

  if (renderedView !== "match") {
    appRoot.innerHTML = renderMatch();
    renderedView = "match";
    initMatchComponents();
  }

  bindMatchActions();
  updateMatchView();
  startMatchRenderLoop();
}

function initMatchComponents(): void {
  const localWrap = document.querySelector<HTMLElement>("#local-board-wrap");
  const opponentWrap = document.querySelector<HTMLElement>("#opponent-board-wrap");
  const announcerEl = document.querySelector<HTMLElement>("#announcer-stack");

  if (localWrap) localBoardRenderer = new BoardRenderer(localWrap);
  if (opponentWrap) opponentBoardRenderer = new BoardRenderer(opponentWrap);
  if (announcerEl) bannerStack = new BannerStack(announcerEl);
}

function destroyMatchComponents(): void {
  localBoardRenderer?.destroy();
  opponentBoardRenderer?.destroy();
  bannerStack?.clear();
  localBoardRenderer = null;
  opponentBoardRenderer = null;
  bannerStack = null;
}

// ── Match render loop ─────────────────────────────────────────
function startMatchRenderLoop(): void {
  if (matchAnimationFrame !== 0) return;

  const frame = (now: number): void => {
    if (state.view !== "match") {
      matchAnimationFrame = 0;
      return;
    }
    bannerStack?.tick(now);
    tickMatchTime(now);
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

function tickMatchTime(now: number): void {
  if (!state.currentMatch || state.currentMatch.status !== "playing" || matchStartTime <= 0) return;
  const matchTimeEl = document.querySelector<HTMLElement>("#match-time-val");
  if (matchTimeEl) {
    const elapsed = Math.floor((now - matchStartTime) / 1000);
    matchTimeEl.textContent = formatMatchTime(elapsed);
  }
}

// ── Match view ────────────────────────────────────────────────
function updateMatchView(): void {
  if (state.view !== "match") return;

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

  if (!overlay || !resultScreen || !localName || !opponentName || !localB2b || !opponentB2b ||
      !localPending || !opponentPending || !localScore || !localLevel || !localLines ||
      !localCombo || !localAttack || !opponentScore || !localHold || !localNext) {
    return;
  }

  // Result screen
  if (state.result) {
    const result = state.result;
    const isVictory = snapshot ? result.winnerId === snapshot.you.playerId : false;
    const loserNickname = snapshot
      ? (isVictory ? snapshot.opponent.nickname : snapshot.you.nickname)
      : "Opponent";

    const particleColors = [
      "#00f5ff", "#ffd700", "#39ff14", "#bf5fff", "#ff8c00",
      "#7fffff", "#ff2442", "#3d6fff", "#00f5ff", "#ffd700",
      "#39ff14", "#bf5fff", "#ff8c00", "#7fffff", "#ff2442",
      "#3d6fff", "#00f5ff", "#ffd700", "#39ff14", "#bf5fff",
      "#ff8c00", "#7fffff", "#ff2442", "#3d6fff"
    ];
    const particles = isVictory
      ? particleColors
          .map((color, i) => {
            const tx = Math.round((Math.random() - 0.5) * 300);
            const ty = Math.round(-100 - Math.random() * 160);
            const delay = ((i * 0.038 + Math.random() * 0.22)).toFixed(2);
            return `<span class="result-particle" style="--tx:${tx}px;--ty:${ty}px;--delay:${delay}s;--color:${color}"></span>`;
          })
          .join("")
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
        <p class="result-note">Returning to lobby…</p>
      </div>
    `;
  } else {
    resultScreen.hidden = true;
    resultScreen.className = "result-screen";
  }

  if (!snapshot) {
    overlay.hidden = false;
    overlay.innerHTML = "CONNECTING";
    localHold.innerHTML = renderPiecePreview("HOLD", null);
    localNext.innerHTML = renderPiecePreview("NEXT", null);
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

  const localPendingN = document.querySelector<HTMLElement>("#local-pending-n");
  const opponentPendingN = document.querySelector<HTMLElement>("#opponent-pending-n");
  const opponentLines = document.querySelector<HTMLElement>("#opponent-lines");
  const opponentCombo = document.querySelector<HTMLElement>("#opponent-combo");
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

  localHold.innerHTML = renderPiecePreview("HOLD", snapshot.you.hold, !snapshot.you.canHold);
  localNext.innerHTML = renderPiecePreview("NEXT", snapshot.you.queue[0] ?? null);

  if (snapshot.status === "finished" && !state.result) {
    overlay.hidden = false;
    overlay.innerHTML = snapshot.you.isTopOut ? "GAME OVER" : "OPPONENT DOWN";
  } else {
    overlay.hidden = snapshot.status !== "countdown" || !snapshot.message;
    overlay.innerHTML =
      snapshot.status === "countdown" && snapshot.message
        ? escapeHtml(snapshot.message.toUpperCase())
        : "";
  }

  // Board rendering via PixiJS
  localBoardRenderer?.update(snapshot.you);
  opponentBoardRenderer?.update(snapshot.opponent);
}

function processSnapshotTransitions(snapshot: MatchSnapshot): void {
  if (!previousSnapshot) {
    pushBanner("ROUND 1", `${snapshot.you.nickname} VS ${snapshot.opponent.nickname}`, "start", 1600);
  }

  if (previousSnapshot?.status === "countdown" && snapshot.status === "playing") {
    matchStartTime = performance.now();
    pushBanner("FIGHT", "Stack and survive", "start", 1600, true);
  }

  if (snapshot.status === "countdown" && previousSnapshot) {
    const prevSec = Math.ceil(previousSnapshot.countdownMs / 1000);
    const curSec = Math.ceil(snapshot.countdownMs / 1000);
    if (curSec !== prevSec && curSec > 0) triggerCountdownPop();
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
  void overlay.offsetWidth;
  overlay.classList.add("countdown-pop");
}

// ── Score bursts (persistent DOM) ────────────────────────────
function pushScoreBurst(side: BurstSide, event: ScoringEvent): void {
  const container = document.querySelector<HTMLElement>(`#${side}-bursts`);
  if (!container) return;

  const bonusParts: string[] = [];
  if (event.comboBonus > 0) bonusParts.push(`COMBO +${event.comboBonus}`);
  if (event.backToBackBonus > 0) bonusParts.push(`B2B +${event.backToBackBonus}`);
  if (event.linesCleared === 0) bonusParts.push(`DROP +${event.dropPoints}`);

  const el = document.createElement("div");
  el.className = "score-burst";

  const titleEl = document.createElement("div");
  titleEl.className = "score-burst-title";
  titleEl.textContent = event.label ?? `LEVEL ${event.level}`;
  el.appendChild(titleEl);

  const pointsEl = document.createElement("div");
  pointsEl.className = "score-burst-points";
  pointsEl.textContent = `+${formatScore(event.points)}`;
  el.appendChild(pointsEl);

  if (bonusParts.length > 0) {
    const bonusEl = document.createElement("div");
    bonusEl.className = "score-burst-bonus";
    bonusEl.textContent = bonusParts.join(" · ");
    el.appendChild(bonusEl);
  }

  container.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });

  if (side === "local" && (event.linesCleared >= 2 || event.comboBonus > 0 || event.backToBackBonus > 0)) {
    pushBanner(event.label ?? "SCORE", `+${formatScore(event.points)} POINTS`, "score", 2500);
  }
}

// ── Banner management ─────────────────────────────────────────
function pushBanner(
  title: string,
  subtitle: string | undefined,
  tone: BannerTone,
  durationMs: number,
  hero = false
): void {
  const id = ++announcementId;
  bannerStack?.push(id, title, subtitle, tone, durationMs, hero);
}

function resetMatchState(): void {
  bannerStack?.clear();
  previousSnapshot = null;
  seenLocalScoreEventId = 0;
  seenOpponentScoreEventId = 0;
  matchStartTime = 0;
  announcementId = 0;
}

// ── Score ticker ──────────────────────────────────────────────
const scoreTickRafs = new Map<string, number>();

function tickScoreTo(el: HTMLElement, target: number): void {
  const id = el.id;
  const currentTarget = Number(el.dataset.scoreTo ?? "0");
  if (currentTarget === target) return;

  const fromValue = Number(el.dataset.scoreFrom ?? "0");
  el.dataset.scoreFrom = String(fromValue);
  el.dataset.scoreTo = String(target);

  const existing = scoreTickRafs.get(id);
  if (existing !== undefined) window.cancelAnimationFrame(existing);

  const startTime = performance.now();
  const duration = 420;

  const tick = (now: number): void => {
    const progress = Math.min(1, (now - startTime) / duration);
    const from = Number(el.dataset.scoreFrom ?? "0");
    const to = Number(el.dataset.scoreTo ?? "0");
    el.textContent = formatScore(Math.round(from + (to - from) * progress));
    if (progress < 1) {
      scoreTickRafs.set(id, window.requestAnimationFrame(tick));
    } else {
      el.dataset.scoreFrom = String(target);
      scoreTickRafs.delete(id);
    }
  };

  scoreTickRafs.set(id, window.requestAnimationFrame(tick));
}

// ── HTML Templates ────────────────────────────────────────────
function renderLobby(): string {
  const medals = ["🥇", "🥈", "🥉"];
  const rows =
    state.leaderboard.length > 0
      ? state.leaderboard
          .map((entry, i) => {
            const losses = entry.gamesPlayed - entry.wins;
            const pct = entry.gamesPlayed > 0 ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0;
            const pctStyle =
              pct >= 60 ? `color:var(--accent)` : pct <= 35 && entry.gamesPlayed > 0 ? `color:var(--danger)` : "";
            const isMe = entry.nickname === state.nickname.trim();
            const rank = i < 3 ? medals[i] : String(i + 1);
            return `<tr class="${isMe ? "leaderboard-me" : ""}">
              <td>${rank}</td>
              <td>${escapeHtml(entry.nickname)}</td>
              <td class="stat-value" style="font-size:0.85rem">${formatScore(entry.bestScore)}</td>
              <td>${entry.wins}</td>
              <td>${losses}</td>
              <td style="${pctStyle}">${entry.gamesPlayed > 0 ? `${pct}%` : "—"}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="muted" style="text-align:center;padding:1.5rem 0">No matches recorded yet.</td></tr>`;

  return `
    <main class="shell">
      <section class="hero">
        <div class="panel stack">
          <div class="lobby-brand">
            <p class="stat-label" style="margin:0 0 0.4rem">ONLINE PVP · KEYBOARD</p>
            <h1 class="title">Tetris<br>Arena</h1>
            <p class="muted" style="margin-top:0.4rem;font-size:0.82rem;letter-spacing:0.04em">Clear lines, pressure your opponent, survive the garbage war.</p>
          </div>
          <div class="stack lobby-setup">
            <div class="stat-label">CALLSIGN</div>
            <input id="nickname" maxlength="18" placeholder="Enter your callsign…" value="${escapeHtml(state.nickname)}" />
          </div>
          <div class="stack" style="gap:0.55rem">
            <div class="row">
              <button id="queue-btn" class="primary" ${state.queueStatus.inQueue || !state.lobbyRoom ? "disabled" : ""}>${state.queueStatus.inQueue ? "SEARCHING…" : "FIND MATCH"}</button>
              <button id="leave-btn" class="secondary" ${state.queueStatus.inQueue ? "" : "disabled"}>LEAVE</button>
            </div>
            <div class="status-pill ${state.error ? "error" : state.queueStatus.inQueue ? "queueing" : ""}">
              ${
                state.error
                  ? `<span>${escapeHtml(state.error)}</span><button id="retry-btn" class="secondary" style="padding:0.2rem 0.6rem;font-size:0.68rem;margin-left:0.4rem">RETRY</button>`
                  : state.queueStatus.inQueue
                    ? `<span class="queue-radar"><span></span><span></span><span></span></span><span>Scanning for rival…</span>`
                    : "Ready — enter callsign and join"
              }
            </div>
          </div>
          <div class="lobby-meta">
            <div class="lobby-stats">
              <div>
                <div class="stat-label">ONLINE</div>
                <div class="stat-value">${state.lobbySnapshot?.connectedPlayers ?? "—"}</div>
              </div>
              <div>
                <div class="stat-label">IN QUEUE</div>
                <div class="stat-value">${state.queueStatus.queueSize}</div>
              </div>
              <div>
                <div class="stat-label">ACTIVE GAMES</div>
                <div class="stat-value">${state.lobbySnapshot?.activeGames ?? "—"}</div>
              </div>
              <div>
                <div class="stat-label">GAMES PLAYED</div>
                <div class="stat-value">${state.lobbySnapshot?.gamesPlayedSinceStart ?? "—"}</div>
              </div>
              <div>
                <div class="stat-label">AVG WAIT</div>
                <div class="stat-value">${state.lobbySnapshot && state.lobbySnapshot.avgWaitMs > 0 ? formatDuration(state.lobbySnapshot.avgWaitMs) : "—"}</div>
              </div>
              <div>
                <div class="stat-label">PING</div>
                <div class="stat-value">${state.pingMs !== null ? `${state.pingMs}ms` : "—"}</div>
              </div>
              ${state.queueStatus.inQueue && state.queueJoinTime !== null
                ? `<div>
                    <div class="stat-label">WAITING</div>
                    <div class="stat-value">${formatDuration(performance.now() - state.queueJoinTime)}</div>
                  </div>`
                : ""}
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
              <p class="muted" style="margin:0.15rem 0 0;font-size:0.8rem">Ranked by best match score</p>
            </div>
            <div class="status-pill">Top ${state.leaderboard.length}</div>
          </div>
          <table class="leaderboard">
            <thead>
              <tr>
                <th>#</th><th>Player</th><th>Score</th><th>W</th><th>L</th><th>Win%</th>
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
            <div class="player-pill-name" id="local-name">YOU</div>
            <div class="player-pill-live"><span class="live-dot"></span>LIVE</div>
            <div id="local-b2b" class="b2b-badge"></div>
          </div>
          <div class="players-bar-center">
            <div class="players-bar-vs">VS</div>
          </div>
          <div class="player-pill player-pill--right">
            <div id="opponent-b2b" class="b2b-badge"></div>
            <div class="player-pill-name" id="opponent-name">OPPONENT</div>
          </div>
        </div>

        <div id="announcer-stack" class="announcer-stack"></div>
        <div id="result-screen" class="result-screen" hidden></div>

        <div class="arena">
          <aside class="arena-stats">
            <div class="stat-item">
              <div class="stat-label">Lines</div>
              <div class="stat-value" id="local-lines">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Level</div>
              <div class="stat-value" id="local-level">1</div>
            </div>
            <div class="stat-item stat-item--score">
              <div class="stat-label">Score</div>
              <div class="stat-value" id="local-score">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Combo</div>
              <div class="stat-value" id="local-combo">—</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Sent</div>
              <div class="stat-value" id="local-attack">0</div>
            </div>
          </aside>

          <div class="board-col">
            <div id="local-pending" class="pending-strip"></div>
            <div id="local-board-wrap" class="canvas-wrap">
              <div id="local-bursts" class="score-bursts score-bursts-local"></div>
              <div id="match-overlay" class="overlay" hidden></div>
            </div>
          </div>

          <div class="arena-center">
            <div id="local-hold-slot"></div>
            <div id="local-next-slot"></div>
            <div class="center-sep"></div>
            <div class="center-trash">
              <div class="stat-label">Incoming</div>
              <div id="local-pending-n" class="trash-n">—</div>
              <div class="trash-arrows-icon">⇵</div>
              <div id="opponent-pending-n" class="trash-n muted">—</div>
              <div class="stat-label">Sending</div>
            </div>
          </div>

          <div class="board-col">
            <div id="opponent-pending" class="pending-strip pending-strip--right"></div>
            <div id="opponent-board-wrap" class="canvas-wrap canvas-wrap--sm">
              <div id="opponent-bursts" class="score-bursts score-bursts-opponent"></div>
            </div>
          </div>

          <aside class="arena-stats arena-stats--right">
            <div class="stat-item">
              <div class="stat-label">Lines</div>
              <div class="stat-value muted" id="opponent-lines">0</div>
            </div>
            <div class="stat-item stat-item--score">
              <div class="stat-label">Score</div>
              <div class="stat-value" id="opponent-score">0</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Combo</div>
              <div class="stat-value muted" id="opponent-combo">—</div>
            </div>
          </aside>
        </div>

        <div class="match-footer panel">
          <div class="match-time-block">
            <span class="stat-label">Time</span>
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

// ── Piece preview ─────────────────────────────────────────────
function renderPiecePreview(label: string, piece: PieceType | null, locked = false): string {
  const cells = piece ? PIECES[piece][0]!.map(({ x, y }) => y * 4 + x) : [];
  const color = piece ? (NEON_COLORS[piece] ?? "transparent") : "transparent";
  return `
    <section class="piece-panel${locked ? " piece-panel--locked" : ""}">
      <span class="piece-label">${label}</span>
      <div class="piece-preview">
        ${Array.from({ length: 16 }, (_, idx) => {
          const filled = cells.includes(idx);
          return `<span class="piece-preview-cell${filled ? " filled" : ""}" ${filled ? `style="--piece-color:${color}"` : ""}></span>`;
        }).join("")}
      </div>
      <strong class="piece-code">${piece ?? "—"}</strong>
    </section>
  `;
}

// ── Lobby actions ─────────────────────────────────────────────
function bindLobbyActions(): void {
  const nicknameInput = document.querySelector<HTMLInputElement>("#nickname");
  const queueButton = document.querySelector<HTMLButtonElement>("#queue-btn");
  const leaveButton = document.querySelector<HTMLButtonElement>("#leave-btn");

  nicknameInput?.addEventListener("input", (event) => {
    state.nickname = (event.currentTarget as HTMLInputElement).value;
    window.localStorage.setItem(storageKey, state.nickname);
  });

  queueButton?.addEventListener("click", () => {
    const nickname = state.nickname.trim();
    if (!nickname) {
      state.error = "Choose a callsign before joining the queue.";
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

// ── Match actions ─────────────────────────────────────────────
function bindMatchActions(): void {
  window.onkeydown = (event: KeyboardEvent) => {
    const action = mapKeyToAction(event);
    if (!action || !state.matchRoom) return;
    if ((action === "hardDrop" || action === "hold") && event.repeat) return;
    event.preventDefault();
    state.matchRoom.send(MATCH_MESSAGES.input, { action });
  };
}

// ── Utilities ─────────────────────────────────────────────────
function mapKeyToAction(event: KeyboardEvent): InputAction | null {
  switch (event.key) {
    case "ArrowLeft":  return "moveLeft";
    case "ArrowRight": return "moveRight";
    case "ArrowDown":  return "softDrop";
    case " ":          return "hardDrop";
    case "x": case "X": case "ArrowUp": return "rotateCW";
    case "z": case "Z": return "rotateCCW";
    case "Shift": case "c": case "C": return "hold";
    default: return null;
  }
}

function formatScore(value: number): string {
  return value.toLocaleString();
}

function formatMatchTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
