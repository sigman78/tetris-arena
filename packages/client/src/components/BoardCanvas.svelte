<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BoardRenderer } from '../pixi/BoardRenderer.js';
  import type { BoardSnapshot } from '@tetris-arena/shared';

  /** Board snapshot to render. Null while connecting. */
  export let snapshot: BoardSnapshot | null = null;
  /** When true applies the smaller opponent board sizing. */
  export let small: boolean = false;

  let container: HTMLDivElement;
  let renderer: BoardRenderer | null = null;

  onMount(() => {
    renderer = new BoardRenderer(container);
  });

  onDestroy(() => {
    renderer?.destroy();
    renderer = null;
  });

  $: if (renderer && snapshot) renderer.update(snapshot);
</script>

<style>
  .canvas-wrap {
    position: relative;
    width: min(100%, 260px, 25vw, calc(100vh - 13rem));
    aspect-ratio: 1 / 2;
    margin: 0 auto;
    border-radius: 2px;
    overflow: hidden;
    background: #020810;
    border: 1px solid rgba(0, 245, 255, 0.28);
    box-shadow:
      0 0 0 1px rgba(0, 245, 255, 0.08),
      0 0 28px rgba(0, 245, 255, 0.12),
      inset 0 0 20px rgba(0, 0, 0, 0.9);
  }

  .canvas-wrap--sm {
    width: min(100%, 180px, 17vw, calc(100vh - 15rem));
    border-color: rgba(191, 95, 255, 0.22);
    box-shadow:
      0 0 0 1px rgba(191, 95, 255, 0.06),
      0 0 20px rgba(191, 95, 255, 0.1),
      inset 0 0 16px rgba(0, 0, 0, 0.9);
  }

  /* Status overlay (countdown, connecting, game-over) */
  :global(.overlay) {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(180deg, rgba(4, 8, 18, 0.2), rgba(4, 8, 18, 0.86));
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-align: center;
    pointer-events: none;
    color: var(--accent);
    text-shadow: 0 0 14px var(--accent);
  }

  @media (max-width: 960px) {
    .canvas-wrap {
      width: min(100%, 200px, 38vw, calc(100vh - 15rem));
    }

    .canvas-wrap--sm {
      width: min(100%, 148px, 28vw, calc(100vh - 15rem));
    }
  }

  @media (max-height: 820px) {
    .canvas-wrap {
      width: min(100%, 220px, 22vw, calc(100vh - 11rem));
    }

    .canvas-wrap--sm {
      width: min(100%, 158px, 15vw, calc(100vh - 12rem));
    }
  }
</style>

<!--
  Slot: accepts score-burst divs, countdown overlays, etc. that float
  over the canvas while remaining inside the positioned canvas-wrap.
-->
<div
  bind:this={container}
  class="canvas-wrap"
  class:canvas-wrap--sm={small}
>
  <slot />
</div>
