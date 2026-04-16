export type BannerTone = "neutral" | "start" | "danger" | "victory" | "score";

interface LiveBanner {
  el: HTMLElement;
  expiresAt: number;
}

export class BannerStack {
  private live = new Map<number, LiveBanner>();

  constructor(private readonly container: HTMLElement) {}

  push(
    id: number,
    title: string,
    subtitle: string | undefined,
    tone: BannerTone,
    durationMs: number,
    hero = false
  ): void {
    // Don't duplicate the same event id
    if (this.live.has(id)) return;

    const el = document.createElement("div");
    el.className = [
      "announcer-banner",
      `tone-${tone}`,
      hero ? "announcer-banner--hero" : ""
    ]
      .filter(Boolean)
      .join(" ");

    const titleEl = document.createElement("div");
    titleEl.className = "announcer-title";
    titleEl.textContent = title;
    el.appendChild(titleEl);

    if (subtitle) {
      const subEl = document.createElement("div");
      subEl.className = "announcer-subtitle";
      subEl.textContent = subtitle;
      el.appendChild(subEl);
    }

    this.container.prepend(el);
    this.live.set(id, { el, expiresAt: performance.now() + durationMs });
  }

  tick(now: number): void {
    for (const [id, { el, expiresAt }] of this.live) {
      if (now >= expiresAt && !el.classList.contains("fading")) {
        el.classList.add("fading");
        el.addEventListener(
          "animationend",
          () => {
            el.remove();
            this.live.delete(id);
          },
          { once: true }
        );
      }
    }
  }

  clear(): void {
    for (const { el } of this.live.values()) {
      el.remove();
    }
    this.live.clear();
  }
}
