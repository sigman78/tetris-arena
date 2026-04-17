<script lang="ts">
  import { queueStatus, lobbyError } from '../stores/lobby.js';
  import { queueJoinTime } from '../services/colyseus.js';
  import { formatDuration } from '../utils/format.js';
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let now = performance.now();
  let ticker: ReturnType<typeof setInterval>;

  onMount(() => { ticker = setInterval(() => { now = performance.now(); }, 1000); });
  onDestroy(() => clearInterval(ticker));

  function handleRetry() {
    dispatch('retry');
  }
</script>

<div class="status-pill" class:queueing={$queueStatus.inQueue && !$lobbyError} class:error={!!$lobbyError}>
  {#if $lobbyError}
    <span>{$lobbyError}</span>
    <button class="secondary" style="padding:0.2rem 0.6rem;font-size:0.68rem;margin-left:0.4rem" on:click={handleRetry}>RETRY</button>
  {:else if $queueStatus.inQueue}
    <span class="queue-radar">
      <span></span>
      <span></span>
      <span></span>
    </span>
    <span>Scanning for rival…</span>
  {:else}
    Ready — enter callsign and join
  {/if}
</div>

{#if $queueStatus.inQueue && $queueJoinTime !== null}
  <div>
    <div class="stat-label">WAITING</div>
    <div class="stat-value">{formatDuration(now - $queueJoinTime)}</div>
  </div>
{/if}

<style>
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 2px;
    padding: 0.45rem 0.8rem;
    background: rgba(0, 245, 255, 0.06);
    border: 1px solid rgba(0, 245, 255, 0.12);
    color: var(--text);
    font-size: 0.8rem;
    letter-spacing: 0.06em;
  }

  .status-pill.queueing {
    color: var(--accent-strong);
    border-color: rgba(0, 245, 255, 0.3);
  }

  .status-pill.error {
    color: var(--danger);
    border-color: rgba(255, 36, 66, 0.3);
  }

  .queue-radar {
    display: inline-grid;
    grid-auto-flow: column;
    gap: 0.25rem;
    align-items: center;
  }

  .queue-radar span {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: currentColor;
    animation: queue-pulse 1.1s infinite ease-in-out;
  }

  .queue-radar span:nth-child(2) { animation-delay: 0.15s; }
  .queue-radar span:nth-child(3) { animation-delay: 0.3s; }
  /* queue-pulse @keyframes lives in styles/animations.css */
</style>
