<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { matchSnapshot, matchResult } from '../stores/match.js';
  import { sendMatchInput } from '../services/colyseus.js';
  import { mapKeyToAction, formatScore } from '../utils/format.js';
  import type { ScoringEvent } from '@tetris-arena/shared';

  import BoardCanvas from '../components/BoardCanvas.svelte';
  import PiecePreview from '../components/PiecePreview.svelte';
  import PendingGarbage from '../components/PendingGarbage.svelte';
  import ScorePanel from '../components/ScorePanel.svelte';
  import BannerStack from '../components/BannerStack.svelte';
  import type { BannerTone } from '../components/BannerStack.svelte';
  import ResultOverlay from '../components/ResultOverlay.svelte';
  import MatchTimer from '../components/MatchTimer.svelte';

  // ── Banner stack ref ──────────────────────────────────────────
  let bannerStack: BannerStack;

  // ── Snapshot transition tracking ─────────────────────────────
  let prevStatus: string | null = null;
  let seenLocalEventId = 0;
  let seenOpponentEventId = 0;
  let announcementId = 0;
  let prevCountdownSec = -1;

  // ── Countdown pop animation key ───────────────────────────────
  let overlayPopKey = 0;

  // ── Score bursts ──────────────────────────────────────────────
  interface BurstItem { id: number; event: ScoringEvent; }
  let localBursts: BurstItem[] = [];
  let opponentBursts: BurstItem[] = [];
  let burstSeq = 0;

  // ── Reactive: process snapshot transitions ────────────────────
  $: snap = $matchSnapshot;
  $: result = $matchResult;
  $: if (snap !== null) processTransitions(snap);

  function processTransitions(s: NonNullable<typeof snap>): void {
    if (prevStatus === null) {
      pushBanner('ROUND 1', `${s.you.nickname} VS ${s.opponent.nickname}`, 'start', 1600);
    }
    if (prevStatus === 'countdown' && s.status === 'playing') {
      pushBanner('FIGHT', 'Stack and survive', 'start', 1600, true);
    }
    if (s.status === 'countdown') {
      const curSec = Math.ceil(s.countdownMs / 1000);
      if (curSec !== prevCountdownSec && curSec > 0) {
        prevCountdownSec = curSec;
        overlayPopKey = overlayPopKey + 1; // triggers CSS pop via {#key} block
      }
    }
    if (s.you.lastScoringEvent && s.you.lastScoringEvent.id > seenLocalEventId) {
      seenLocalEventId = s.you.lastScoringEvent.id;
      addScoreBurst('local', s.you.lastScoringEvent);
    }
    if (s.opponent.lastScoringEvent && s.opponent.lastScoringEvent.id > seenOpponentEventId) {
      seenOpponentEventId = s.opponent.lastScoringEvent.id;
      addScoreBurst('opponent', s.opponent.lastScoringEvent);
    }
    prevStatus = s.status;
  }

  function pushBanner(title: string, subtitle: string | undefined, tone: BannerTone, durationMs: number, hero = false): void {
    bannerStack?.push(++announcementId, title, subtitle, tone, durationMs, hero);
  }

  function addScoreBurst(side: 'local' | 'opponent', event: ScoringEvent): void {
    const id = ++burstSeq;
    if (side === 'local') {
      localBursts = [...localBursts, { id, event }];
      if (event.linesCleared >= 2 || event.comboBonus > 0 || event.backToBackBonus > 0) {
        pushBanner(event.label ?? 'SCORE', `+${formatScore(event.points)} POINTS`, 'score', 2500);
      }
    } else {
      opponentBursts = [...opponentBursts, { id, event }];
    }
    // Remove after burst-rise animation (2.2s)
    setTimeout(() => {
      if (side === 'local') localBursts = localBursts.filter(b => b.id !== id);
      else opponentBursts = opponentBursts.filter(b => b.id !== id);
    }, 2200);
  }

  function burstBonus(event: ScoringEvent): string {
    const parts: string[] = [];
    if (event.comboBonus > 0) parts.push(`COMBO +${event.comboBonus}`);
    if (event.backToBackBonus > 0) parts.push(`B2B +${event.backToBackBonus}`);
    if (event.linesCleared === 0) parts.push(`DROP +${event.dropPoints}`);
    return parts.join(' · ');
  }

  // ── Overlay text / visibility ─────────────────────────────────
  $: overlayText = (() => {
    if (!snap) return 'CONNECTING';
    if (snap.status === 'finished' && !result) {
      return snap.you.isTopOut ? 'GAME OVER' : 'OPPONENT DOWN';
    }
    if (snap.status === 'countdown' && snap.message) {
      return snap.message.toUpperCase();
    }
    return '';
  })();
  $: showOverlay = !snap
    || (snap.status === 'countdown' && !!snap.message)
    || (snap.status === 'finished' && !result);

  // ── Keyboard input ────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent): void {
    const action = mapKeyToAction(e.key);
    if (!action) return;
    if ((action === 'hardDrop' || action === 'hold') && e.repeat) return;
    e.preventDefault();
    sendMatchInput(action);
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    bannerStack?.clear();
    prevStatus = null;
    seenLocalEventId = 0;
    seenOpponentEventId = 0;
    announcementId = 0;
    prevCountdownSec = -1;
    overlayPopKey = 0;
    localBursts = [];
    opponentBursts = [];
  });
</script>

<style>
  .game {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    gap: 0.7rem;
  }

  /* ── Players bar ──────────────────────────────────────────── */
  .players-bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.4rem;
  }

  .player-pill {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .player-pill--right {
    justify-content: flex-end;
    flex-direction: row-reverse;
  }

  .player-pill-name {
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent-strong);
  }

  .player-pill-live {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--accent);
    text-transform: uppercase;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: live-pulse 2.2s ease-in-out infinite;
  }

  .players-bar-center {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .players-bar-vs {
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 0.35em;
    color: var(--muted);
  }

  /* ── B2B badge ────────────────────────────────────────────── */
  .b2b-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 2px;
    padding: 0.12rem 0.5rem;
    font-size: 0.62rem;
    font-weight: 900;
    letter-spacing: 0.14em;
    color: var(--accent);
    border: 1px solid rgba(0, 245, 255, 0.3);
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }

  .b2b-badge.active {
    opacity: 1;
    text-shadow: 0 0 6px rgba(0, 245, 255, 0.6);
    animation: b2b-pulse 2.4s ease-in-out infinite;
  }

  /* ── Arena grid ───────────────────────────────────────────── */
  .arena {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) 110px minmax(0, 0.62fr) 62px;
    gap: 0.75rem;
    align-items: start;
  }

  .arena-stats {
    display: grid;
    align-content: start;
    gap: 1rem;
    padding-top: 1rem;
  }

  .arena-stats--right {
    text-align: right;
  }

  .board-col {
    display: grid;
    gap: 0.3rem;
    justify-items: center;
  }

  /* ── Centre column ────────────────────────────────────────── */
  .arena-center {
    display: grid;
    gap: 0.45rem;
    justify-items: stretch;
    padding-top: 0.6rem;
  }

  .center-sep {
    height: 1px;
    background: rgba(0, 245, 255, 0.08);
    margin: 0.1rem 0;
  }

  .center-trash {
    display: grid;
    gap: 0.2rem;
    justify-items: center;
    text-align: center;
    padding: 0.5rem 0.35rem;
    border-radius: 2px;
    background: rgba(255, 140, 0, 0.04);
    border: 1px solid rgba(255, 140, 0, 0.1);
  }

  .trash-n {
    font-size: 1rem;
    font-weight: 800;
    color: var(--warning);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-shadow: 0 0 8px rgba(255, 140, 0, 0.4);
  }

  .trash-n.muted {
    color: var(--muted);
    font-size: 0.82rem;
    text-shadow: none;
  }

  .trash-arrows-icon {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.15);
    line-height: 1.4;
  }

  /* ── Score bursts ─────────────────────────────────────────── */
  .score-bursts {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: grid;
    align-content: start;
    gap: 0.45rem;
    padding: 0.8rem;
  }

  .score-bursts-local    { justify-items: start; }
  .score-bursts-opponent { justify-items: end; }

  .score-burst {
    min-width: 110px;
    padding: 0.4rem 0.65rem;
    border-radius: 2px;
    background: rgba(10, 14, 28, 0.96);
    border: 1px solid rgba(255, 215, 0, 0.4);
    box-shadow: 0 0 14px rgba(255, 215, 0, 0.15), 0 10px 24px rgba(0, 0, 0, 0.5);
    animation: burst-rise 2.2s ease forwards;
  }

  .score-burst-title {
    font-size: 0.65rem;
    font-weight: 900;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #ffd700;
    text-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
  }

  .score-burst-points {
    font-size: 1rem;
    font-weight: 900;
    color: #ffffff;
    letter-spacing: 0.06em;
  }

  .score-burst-bonus {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    color: rgba(232, 244, 255, 0.72);
  }

  /* ── Match footer ─────────────────────────────────────────── */
  .match-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 1.4rem;
  }

  .hud {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
  }

  .hud :global(strong) {
    color: var(--accent);
  }

  /* ── Responsive ───────────────────────────────────────────── */
  @media (max-width: 960px) {
    .arena {
      grid-template-columns: 56px minmax(0, 1fr) 88px minmax(0, 0.65fr) 50px;
      gap: 0.5rem;
    }

    .arena-stats {
      gap: 0.75rem;
      padding-top: 0.75rem;
    }

    .players-bar {
      padding: 0.65rem 1rem;
    }
  }
</style>

<main class="shell match-shell">
  <section class="game">

    <!-- Players bar -->
    <div class="players-bar panel">
      <div class="player-pill">
        <div class="player-pill-name">{snap?.you.nickname ?? 'YOU'}</div>
        <div class="player-pill-live"><span class="live-dot"></span>LIVE</div>
        <div class="b2b-badge" class:active={snap?.you.backToBack}>
          {snap?.you.backToBack ? 'B2B' : ''}
        </div>
      </div>
      <div class="players-bar-center">
        <div class="players-bar-vs">VS</div>
      </div>
      <div class="player-pill player-pill--right">
        <div class="b2b-badge" class:active={snap?.opponent.backToBack}>
          {snap?.opponent.backToBack ? 'B2B' : ''}
        </div>
        <div class="player-pill-name">{snap?.opponent.nickname ?? 'OPPONENT'}</div>
      </div>
    </div>

    <!-- Announcer banners (fixed, centred) -->
    <BannerStack bind:this={bannerStack} />

    <!-- Result overlay (absolute over the section) -->
    <ResultOverlay />

    <!-- Arena grid -->
    <div class="arena">

      <!-- Local stats -->
      <aside class="arena-stats">
        <ScorePanel
          score={snap?.you.score ?? 0}
          level={snap?.you.level ?? 1}
          lines={snap?.you.linesClearedTotal ?? 0}
          combo={snap?.you.combo ?? 0}
          sent={snap?.you.garbageSentTotal ?? 0}
        />
      </aside>

      <!-- Local board -->
      <div class="board-col">
        <PendingGarbage count={snap?.you.pendingGarbage ?? 0} />
        <BoardCanvas snapshot={snap?.you ?? null}>
          <div class="score-bursts score-bursts-local">
            {#each localBursts as burst (burst.id)}
              <div class="score-burst">
                <div class="score-burst-title">{burst.event.label ?? `LEVEL ${burst.event.level}`}</div>
                <div class="score-burst-points">+{formatScore(burst.event.points)}</div>
                {#if burstBonus(burst.event)}
                  <div class="score-burst-bonus">{burstBonus(burst.event)}</div>
                {/if}
              </div>
            {/each}
          </div>
          {#if showOverlay}
            {#key overlayPopKey}
              <div class="overlay" class:countdown-pop={snap?.status === 'countdown'}>
                {overlayText}
              </div>
            {/key}
          {/if}
        </BoardCanvas>
      </div>

      <!-- Centre: hold/next + garbage meter -->
      <div class="arena-center">
        <PiecePreview piece={snap?.you.hold ?? null} label="HOLD" locked={snap ? !snap.you.canHold : false} />
        <PiecePreview piece={snap?.you.queue[0] ?? null} label="NEXT" />
        <div class="center-sep"></div>
        <div class="center-trash">
          <div class="stat-label">Incoming</div>
          <div class="trash-n">
            {(snap?.you.pendingGarbage ?? 0) > 0 ? String(snap!.you.pendingGarbage) : '—'}
          </div>
          <div class="trash-arrows-icon">⇵</div>
          <div class="trash-n muted">
            {(snap?.opponent.pendingGarbage ?? 0) > 0 ? String(snap!.opponent.pendingGarbage) : '—'}
          </div>
          <div class="stat-label">Sending</div>
        </div>
      </div>

      <!-- Opponent board -->
      <div class="board-col">
        <PendingGarbage count={snap?.opponent.pendingGarbage ?? 0} right />
        <BoardCanvas snapshot={snap?.opponent ?? null} small>
          <div class="score-bursts score-bursts-opponent">
            {#each opponentBursts as burst (burst.id)}
              <div class="score-burst">
                <div class="score-burst-title">{burst.event.label ?? `LEVEL ${burst.event.level}`}</div>
                <div class="score-burst-points">+{formatScore(burst.event.points)}</div>
              </div>
            {/each}
          </div>
        </BoardCanvas>
      </div>

      <!-- Opponent stats -->
      <aside class="arena-stats arena-stats--right">
        <ScorePanel
          score={snap?.opponent.score ?? 0}
          level={snap?.opponent.level ?? 1}
          lines={snap?.opponent.linesClearedTotal ?? 0}
          combo={snap?.opponent.combo ?? 0}
          sent={0}
          muted
        />
      </aside>

    </div>

    <!-- Footer -->
    <div class="match-footer panel">
      <MatchTimer />
      <div class="hud">
        <span><strong>Move</strong> ←→↓</span>
        <span><strong>Rotate</strong> X / Z</span>
        <span><strong>Drop</strong> Space</span>
        <span><strong>Hold</strong> Shift / C</span>
      </div>
    </div>

  </section>
</main>
