<script lang="ts">
  import { onDestroy } from 'svelte';

  export type BannerTone = 'neutral' | 'start' | 'danger' | 'victory' | 'score';

  interface Banner {
    id: number;
    title: string;
    subtitle: string | undefined;
    tone: BannerTone;
    hero: boolean;
    expiresAt: number;
    fading: boolean;
  }

  let banners: Banner[] = [];
  let rafId: number | null = null;

  /** Push a new banner. Duplicate ids are silently ignored. */
  export function push(
    id: number,
    title: string,
    subtitle: string | undefined,
    tone: BannerTone,
    durationMs: number,
    hero = false
  ): void {
    if (banners.some(b => b.id === id)) return;
    banners = [
      { id, title, subtitle, tone, hero, expiresAt: performance.now() + durationMs, fading: false },
      ...banners
    ];
    scheduleTick();
  }

  /** Remove all banners immediately. */
  export function clear(): void {
    banners = [];
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function scheduleTick(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    rafId = null;
    let hasActive = false;
    banners = banners.map(b => {
      if (!b.fading && now >= b.expiresAt) {
        // Mark fading; CSS 'announcer-fade' animation plays for 300ms then we remove it
        setTimeout(() => {
          banners = banners.filter(x => x.id !== b.id);
        }, 300);
        return { ...b, fading: true };
      }
      if (!b.fading) hasActive = true;
      return b;
    });
    if (hasActive) scheduleTick();
  }

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });
</script>

<style>
  .announcer-stack {
    position: fixed;
    top: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: grid;
    gap: 0.55rem;
    pointer-events: none;
    min-width: 300px;
  }

  .announcer-banner {
    padding: 0.7rem 1.4rem 0.85rem;
    border-radius: 2px;
    text-align: center;
    text-transform: uppercase;
    background: rgba(4, 8, 18, 0.97);
    border: 2px solid rgba(0, 245, 255, 0.35);
    box-shadow:
      0 0 22px rgba(0, 245, 255, 0.18),
      0 22px 54px rgba(0, 0, 0, 0.75);
    animation: announcer-pop 380ms cubic-bezier(0.18, 0.88, 0.34, 1.26);
  }

  .announcer-banner--hero {
    min-width: 380px;
    padding: 1.1rem 2rem 1.3rem;
  }

  .announcer-banner.tone-start  { border-color: #ffd700; box-shadow: 0 0 22px rgba(255, 215, 0, 0.2), 0 22px 54px rgba(0, 0, 0, 0.75); }
  .announcer-banner.tone-danger  { border-color: var(--danger); box-shadow: 0 0 22px rgba(255, 36, 66, 0.22), 0 22px 54px rgba(0, 0, 0, 0.75); }
  .announcer-banner.tone-victory { border-color: var(--victory); box-shadow: 0 0 22px rgba(57, 255, 20, 0.2), 0 22px 54px rgba(0, 0, 0, 0.75); }
  .announcer-banner.tone-score   { border-color: #5599ff; box-shadow: 0 0 22px rgba(85, 153, 255, 0.2), 0 22px 54px rgba(0, 0, 0, 0.75); }

  .announcer-title {
    font-weight: 900;
    letter-spacing: 0.22em;
    color: #fff;
    text-shadow:
      0 0 10px var(--accent),
      0 0 32px rgba(0, 245, 255, 0.4);
    font-size: clamp(1.1rem, 2.8vw, 1.8rem);
  }

  .announcer-banner--hero .announcer-title {
    font-size: clamp(1.9rem, 5vw, 3.2rem);
    text-shadow:
      0 0 14px var(--accent),
      0 0 48px rgba(0, 245, 255, 0.5);
  }

  .announcer-banner.tone-start .announcer-title  { text-shadow: 0 0 10px #ffd700, 0 0 32px rgba(255, 215, 0, 0.4); }
  .announcer-banner.tone-danger .announcer-title  { text-shadow: 0 0 10px var(--danger), 0 0 32px rgba(255, 36, 66, 0.4); }
  .announcer-banner.tone-victory .announcer-title { text-shadow: 0 0 10px var(--victory), 0 0 32px rgba(57, 255, 20, 0.4); }

  .announcer-subtitle {
    margin-top: 0.2rem;
    font-size: 0.75rem;
    letter-spacing: 0.2em;
    color: rgba(232, 244, 255, 0.8);
  }

  @media (max-width: 960px) {
    .announcer-stack {
      width: calc(100% - 1.5rem);
      min-width: 0;
    }

    .announcer-banner,
    .announcer-banner--hero {
      min-width: 0;
    }
  }
</style>

<div class="announcer-stack">
  {#each banners as banner (banner.id)}
    <div
      class="announcer-banner tone-{banner.tone}"
      class:announcer-banner--hero={banner.hero}
      class:fading={banner.fading}
    >
      <div class="announcer-title">{banner.title}</div>
      {#if banner.subtitle}
        <div class="announcer-subtitle">{banner.subtitle}</div>
      {/if}
    </div>
  {/each}
</div>
