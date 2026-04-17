<script lang="ts">
  export let count: number = 0;
  export let right: boolean = false;
</script>

<style>
  .pending-strip {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-align: center;
    color: var(--warning);
    min-height: 1em;
    opacity: 0;
    transition: opacity 0.2s;
    text-transform: uppercase;
  }

  .pending-strip--active {
    opacity: 1;
    text-shadow: 0 0 8px rgba(255, 140, 0, 0.5);
  }
</style>

<div
  class="pending-strip"
  class:pending-strip--active={count > 0}
  class:pending-strip--right={right}
>
  {count > 0 ? `⚠ ${count} incoming` : ''}
</div>
