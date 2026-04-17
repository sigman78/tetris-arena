<script lang="ts">
  import { PIECES } from '@tetris-arena/shared';
  import type { PieceType } from '@tetris-arena/shared';
  import { NEON_COLORS } from '../pixi/cellTextures.js';

  export let piece: PieceType | null = null;
  export let label: string;
  export let locked: boolean = false;

  $: cells = piece ? PIECES[piece][0]!.map(({ x, y }) => y * 4 + x) : [];
  $: color = piece ? (NEON_COLORS[piece] ?? 'transparent') : 'transparent';
</script>

<style>
  .piece-panel {
    display: grid;
    gap: 0.3rem;
    justify-items: center;
    padding: 0.5rem 0.35rem;
    border-radius: 2px;
    background: rgba(0, 245, 255, 0.04);
    border: 1px solid rgba(0, 245, 255, 0.1);
    width: 100%;
  }

  .piece-label {
    color: var(--muted);
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .piece-code {
    color: var(--text);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
  }

  .piece-preview {
    width: 52px;
    height: 52px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }

  .piece-preview-cell {
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.03);
  }

  .piece-preview-cell.filled {
    background: var(--piece-color);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.3),
      0 0 6px var(--piece-color);
  }

  .piece-panel--locked {
    opacity: 0.38;
  }

  .piece-panel--locked .piece-preview-cell.filled {
    filter: grayscale(0.65);
  }
</style>

<section class="piece-panel" class:piece-panel--locked={locked}>
  <span class="piece-label">{label}</span>
  <div class="piece-preview">
    {#each { length: 16 } as _, idx}
      {@const filled = cells.includes(idx)}
      <span
        class="piece-preview-cell"
        class:filled
        style={filled ? `--piece-color:${color}` : ''}
      ></span>
    {/each}
  </div>
  <strong class="piece-code">{piece ?? '—'}</strong>
</section>
