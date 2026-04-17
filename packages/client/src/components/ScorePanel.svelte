<script lang="ts">
  import { onDestroy } from 'svelte';
  import { formatScore } from '../utils/format.js';

  export let score: number = 0;
  export let level: number = 1;
  export let lines: number = 0;
  export let combo: number = 0;
  export let sent: number = 0;
  /** When true, score is rendered with muted colour (opponent panel) */
  export let muted: boolean = false;

  // ── Animated score ticker ──────────────────────────────────
  let displayScore = 0;
  let fromScore = 0;
  let toScore = 0;
  let rafId: number | null = null;
  let rafStart: number | null = null;
  const DURATION = 420;

  $: if (score !== toScore) {
    fromScore = displayScore;
    toScore = score;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafStart = performance.now();
    animateTick();
  }

  function animateTick(): void {
    rafId = requestAnimationFrame((now) => {
      const progress = Math.min(1, (now - rafStart!) / DURATION);
      displayScore = Math.round(fromScore + (toScore - fromScore) * progress);
      if (progress < 1) {
        animateTick();
      } else {
        displayScore = toScore;
        fromScore = toScore;
        rafId = null;
      }
    });
  }

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });
</script>

<style>
  /* stat-item is scoped to this component; stat-label / stat-value stay global */
  .stat-item {
    display: grid;
    gap: 0.06rem;
  }

  .stat-item--score .stat-value {
    font-size: 1.1rem;
  }
</style>

<div class="stat-item">
  <div class="stat-label">Lines</div>
  <div class="stat-value" class:muted>{lines}</div>
</div>
<div class="stat-item stat-item--score">
  <div class="stat-label">Score</div>
  <div class="stat-value" class:muted>{formatScore(displayScore)}</div>
</div>
<div class="stat-item">
  <div class="stat-label">Combo</div>
  <div class="stat-value" class:muted>{combo > 1 ? `${combo}×` : '—'}</div>
</div>
{#if !muted}
  <div class="stat-item">
    <div class="stat-label">Level</div>
    <div class="stat-value">{level}</div>
  </div>
  <div class="stat-item">
    <div class="stat-label">Sent</div>
    <div class="stat-value">{sent}</div>
  </div>
{/if}
