<script lang="ts">
  import { onDestroy } from 'svelte';
  import { matchSnapshot } from '../stores/match.js';
  import { formatMatchTime } from '../utils/format.js';

  let elapsed = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let startTime: number | null = null;
  let prevStatus: string | null = null;

  const unsub = matchSnapshot.subscribe(snap => {
    if (!snap) return;

    // Transition: countdown → playing starts the clock
    if (prevStatus === 'countdown' && snap.status === 'playing') {
      startTime = performance.now();
      if (!interval) {
        interval = setInterval(() => {
          if (startTime !== null) {
            elapsed = Math.floor((performance.now() - startTime) / 1000);
          }
        }, 1000);
      }
    }

    // Match finished: stop the clock
    if (snap.status === 'finished' && interval !== null) {
      clearInterval(interval);
      interval = null;
    }

    prevStatus = snap.status;
  });

  onDestroy(() => {
    unsub();
    if (interval !== null) clearInterval(interval);
  });
</script>

<style>
  .match-time-block {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
  }

  .match-time-val {
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
    text-shadow: 0 0 8px rgba(0, 245, 255, 0.4);
  }
</style>

<div class="match-time-block">
  <span class="stat-label">Time</span>
  <span class="match-time-val">{formatMatchTime(elapsed)}</span>
</div>
