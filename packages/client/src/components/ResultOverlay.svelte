<script lang="ts">
  import { matchResult, matchSnapshot } from '../stores/match.js';
  import { formatScore } from '../utils/format.js';

  const PARTICLE_COLORS = [
    '#00f5ff', '#ffd700', '#39ff14', '#bf5fff', '#ff8c00',
    '#7fffff', '#ff2442', '#3d6fff', '#00f5ff', '#ffd700',
    '#39ff14', '#bf5fff', '#ff8c00', '#7fffff', '#ff2442',
    '#3d6fff', '#00f5ff', '#ffd700', '#39ff14', '#bf5fff',
    '#ff8c00', '#7fffff', '#ff2442', '#3d6fff'
  ];

  interface Particle { color: string; tx: number; ty: number; delay: string; }

  $: result = $matchResult;
  $: snap = $matchSnapshot;
  $: isVictory = result !== null && snap !== null && result.winnerId === snap.you.playerId;
  $: loserNickname = snap
    ? (isVictory ? snap.opponent.nickname : snap.you.nickname)
    : 'Opponent';

  // Particles are generated once when result arrives (not re-generated on re-render)
  let particles: Particle[] = [];
  $: if (result !== null && isVictory && particles.length === 0) {
    particles = PARTICLE_COLORS.map((color, i) => ({
      color,
      tx: Math.round((Math.random() - 0.5) * 300),
      ty: Math.round(-100 - Math.random() * 160),
      delay: (i * 0.038 + Math.random() * 0.22).toFixed(2)
    }));
  }
  $: if (result === null) particles = [];
</script>

<style>
  .result-screen {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    backdrop-filter: blur(10px);
    border-radius: 3px;
    overflow: hidden;
    animation: result-enter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .result-screen--victory {
    background:
      radial-gradient(circle at 50% 40%, rgba(57, 255, 20, 0.12), transparent 60%),
      rgba(4, 8, 18, 0.92);
  }

  .result-screen--defeat {
    background:
      radial-gradient(circle at 50% 30%, rgba(255, 36, 66, 0.1), transparent 55%),
      rgba(4, 8, 18, 0.92);
  }

  .result-card {
    display: grid;
    gap: 1.2rem;
    justify-items: center;
    text-align: center;
    padding: 2rem 2.5rem;
    border: 1px solid rgba(0, 245, 255, 0.2);
    border-radius: 2px;
    background: rgba(4, 8, 18, 0.6);
  }

  .result-heading {
    font-size: clamp(2.5rem, 7vw, 4.5rem);
    font-weight: 900;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .result-heading.tone-victory {
    color: var(--victory);
    text-shadow: 0 0 24px rgba(57, 255, 20, 0.6), 0 0 60px rgba(57, 255, 20, 0.25);
  }

  .result-heading.tone-danger {
    color: var(--danger);
    text-shadow: 0 0 24px rgba(255, 36, 66, 0.6), 0 0 60px rgba(255, 36, 66, 0.25);
  }

  .result-scores {
    display: flex;
    gap: 2.5rem;
  }

  .result-score-item {
    display: grid;
    gap: 0.2rem;
  }

  .result-score-label {
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .result-score-value {
    font-size: 1.4rem;
    font-weight: 900;
    color: var(--text);
    letter-spacing: 0.06em;
  }

  .result-score-value.muted {
    color: var(--muted);
    font-size: 1.1rem;
  }

  .result-note {
    font-size: 0.78rem;
    color: var(--muted);
    letter-spacing: 0.1em;
    margin-top: 0.25rem;
  }

  .result-particle {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7px;
    height: 7px;
    margin: -3.5px 0 0 -3.5px;
    border-radius: 1px;
    background: var(--color);
    box-shadow: 0 0 6px var(--color);
    animation: particle-fly 1.1s ease-out var(--delay) both;
    pointer-events: none;
  }
</style>

{#if result !== null}
  <div
    class="result-screen"
    class:result-screen--victory={isVictory}
    class:result-screen--defeat={!isVictory}
  >
    {#each particles as p}
      <span
        class="result-particle"
        style="--tx:{p.tx}px;--ty:{p.ty}px;--delay:{p.delay}s;--color:{p.color}"
      ></span>
    {/each}

    <div class="result-card" class:result-card--defeat={!isVictory}>
      <div
        class="result-heading"
        class:tone-victory={isVictory}
        class:tone-danger={!isVictory}
      >
        {isVictory ? 'VICTORY' : 'DEFEAT'}
      </div>

      <div class="result-scores">
        <div class="result-score-item">
          <span class="result-score-label">{result.winnerNickname}</span>
          <span class="result-score-value">{formatScore(result.winnerScore)}</span>
        </div>
        <div class="result-score-item">
          <span class="result-score-label">{loserNickname}</span>
          <span class="result-score-value muted">{formatScore(result.loserScore)}</span>
        </div>
      </div>

      <p class="result-note">Returning to lobby…</p>
    </div>
  </div>
{/if}
