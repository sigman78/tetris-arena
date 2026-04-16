import { Application, Container, Sprite, Texture } from "pixi.js";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  HIDDEN_ROWS,
  VISIBLE_ROWS,
  PIECES
} from "@tetris-arena/shared";
import type { BoardSnapshot } from "@tetris-arena/shared";
import { CellTextureCache, type CellKind } from "./cellTextures.js";
import { type BoardAnimState, createBoardAnimState, tickAnimState } from "./animationState.js";

function makeWhiteTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  c.getContext("2d")!.fillRect(0, 0, 1, 1);
  return Texture.from(c);
}

function makeGridTexture(bw: number, bh: number, cs: number): Texture {
  const c = document.createElement("canvas");
  c.width = bw;
  c.height = bh;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= BOARD_WIDTH; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cs + 0.5, 0);
    ctx.lineTo(x * cs + 0.5, bh);
    ctx.stroke();
  }
  for (let y = 0; y <= VISIBLE_ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cs + 0.5);
    ctx.lineTo(bw, y * cs + 0.5);
    ctx.stroke();
  }
  return Texture.from(c);
}

function makeScanlineTexture(bw: number, bh: number): Texture {
  const c = document.createElement("canvas");
  c.width = bw;
  c.height = bh;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  for (let y = 0; y < bh; y += 4) ctx.fillRect(0, y, bw, 1);
  return Texture.from(c);
}

export class BoardRenderer {
  readonly ready: Promise<void>;
  private app: Application | null = null;
  private textures: CellTextureCache;
  private animState: BoardAnimState;
  private boardContainer: Container | null = null;
  private cellSprites: Sprite[][] = [];
  private ghostSprites: Sprite[] = [];
  private clearFlashOverlay: Sprite | null = null;
  private lockFlashOverlay: Sprite | null = null;
  private garbageBarSprite: Sprite | null = null;
  private dangerOverlay: Sprite | null = null;
  private topOutOverlay: Sprite | null = null;
  private cellSize = 0;
  private boardW = 0;
  private boardH = 0;
  private pendingSnapshot: BoardSnapshot | null = null;

  constructor(private readonly container: HTMLElement) {
    this.textures = new CellTextureCache();
    this.animState = createBoardAnimState();
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    // Wait one frame so container has laid out
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    this.app = new Application();
    await this.app.init({
      resizeTo: this.container,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true
    });

    this.container.querySelector("canvas")?.remove();
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%;";
    this.container.appendChild(canvas);

    const rawW = this.app.screen.width;
    this.cellSize = Math.round(rawW / BOARD_WIDTH);
    this.boardW = this.cellSize * BOARD_WIDTH;
    this.boardH = this.cellSize * VISIBLE_ROWS;
    this.app.renderer.resize(this.boardW, this.boardH);

    this.buildStage();
    this.app.ticker.add(() => this.tickEffects());

    if (this.pendingSnapshot) {
      this.applySnapshot(this.pendingSnapshot);
      this.pendingSnapshot = null;
    }
  }

  private buildStage(): void {
    const app = this.app!;
    const { cellSize: cs, boardW: bw, boardH: bh } = this;
    const whiteTex = makeWhiteTexture();

    // Background
    const bg = new Sprite(whiteTex);
    bg.tint = 0x020810;
    bg.width = bw;
    bg.height = bh;
    app.stage.addChild(bg);

    // Board container (transforms for shake)
    this.boardContainer = new Container();
    app.stage.addChild(this.boardContainer);

    // Cell sprites (VISIBLE_ROWS × BOARD_WIDTH)
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      this.cellSprites[r] = [];
      for (let c = 0; c < BOARD_WIDTH; c++) {
        const sprite = new Sprite(this.textures.get("empty", cs));
        sprite.position.set(c * cs, r * cs);
        sprite.width = cs;
        sprite.height = cs;
        this.boardContainer.addChild(sprite);
        this.cellSprites[r]![c] = sprite;
      }
    }

    // Ghost sprites (4, one per piece cell)
    for (let i = 0; i < 4; i++) {
      const sprite = new Sprite(this.textures.get("ghost_I", cs));
      sprite.width = cs;
      sprite.height = cs;
      sprite.visible = false;
      this.boardContainer.addChild(sprite);
      this.ghostSprites.push(sprite);
    }

    // Grid lines
    const gridSprite = new Sprite(makeGridTexture(bw, bh, cs));
    this.boardContainer.addChild(gridSprite);

    // Garbage bar (bottom edge, orange)
    this.garbageBarSprite = new Sprite(whiteTex);
    this.garbageBarSprite.tint = 0xff8c00;
    this.garbageBarSprite.alpha = 0.24;
    this.garbageBarSprite.width = bw;
    this.garbageBarSprite.height = 0;
    this.boardContainer.addChild(this.garbageBarSprite);

    // Danger overlay (full board, red tint)
    this.dangerOverlay = new Sprite(whiteTex);
    this.dangerOverlay.tint = 0xff2442;
    this.dangerOverlay.alpha = 0;
    this.dangerOverlay.width = bw;
    this.dangerOverlay.height = bh;
    this.boardContainer.addChild(this.dangerOverlay);

    // Clear flash overlay (white)
    this.clearFlashOverlay = new Sprite(whiteTex);
    this.clearFlashOverlay.alpha = 0;
    this.clearFlashOverlay.width = bw;
    this.clearFlashOverlay.height = bh;
    this.boardContainer.addChild(this.clearFlashOverlay);

    // Lock flash overlay (piece color)
    this.lockFlashOverlay = new Sprite(whiteTex);
    this.lockFlashOverlay.alpha = 0;
    this.lockFlashOverlay.width = bw;
    this.lockFlashOverlay.height = bh;
    this.boardContainer.addChild(this.lockFlashOverlay);

    // Top-out darkening overlay (fades in when board tops out)
    this.topOutOverlay = new Sprite(whiteTex);
    this.topOutOverlay.tint = 0x000000;
    this.topOutOverlay.alpha = 0;
    this.topOutOverlay.width = bw;
    this.topOutOverlay.height = bh;
    this.boardContainer.addChild(this.topOutOverlay);

    // Scanline overlay (topmost)
    const scanSprite = new Sprite(makeScanlineTexture(bw, bh));
    app.stage.addChild(scanSprite);
  }

  update(snapshot: BoardSnapshot): void {
    if (!this.app) {
      this.pendingSnapshot = snapshot;
      return;
    }
    tickAnimState(this.animState, snapshot);
    this.applySnapshot(snapshot);
  }

  private applySnapshot(snapshot: BoardSnapshot): void {
    const cs = this.cellSize;

    // Board cells
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      const row = snapshot.board[r + HIDDEN_ROWS]!;
      for (let c = 0; c < BOARD_WIDTH; c++) {
        const cell = row[c] ?? null;
        const kind: CellKind = cell === null ? "empty" : cell;
        this.cellSprites[r]![c]!.texture = this.textures.get(kind, cs);
      }
    }

    // Ghost piece
    const { active, board } = snapshot;
    if (active) {
      const shape = PIECES[active.type][active.rotation]!;
      const activeCells = shape.map(p => ({ x: active.x + p.x, y: active.y + p.y }));
      const activeKeys = new Set(activeCells.map(p => `${p.x},${p.y}`));

      let delta = 0;
      drop: while (true) {
        const nd = delta + 1;
        for (const { x, y } of activeCells) {
          const ny = y + nd;
          if (ny >= BOARD_HEIGHT) break drop;
          if (ny < 0) continue;
          const cell = board[ny]?.[x];
          if (cell !== null && !activeKeys.has(`${x},${ny}`)) break drop;
        }
        delta = nd;
      }

      const ghostKind: CellKind = `ghost_${active.type}`;
      const ghostTex = this.textures.get(ghostKind, cs);

      const ghostAlpha = Math.min(1, 1 - 0.75 / delta);

      activeCells.forEach(({ x, y }, i) => {
        const sp = this.ghostSprites[i]!;
        const gy = y + delta;
        const vy = gy - HIDDEN_ROWS;
        if (delta === 0 || vy < 0 || vy >= VISIBLE_ROWS) {
          sp.visible = false;
          return;
        }
        sp.texture = ghostTex;
        sp.alpha = ghostAlpha;
        sp.position.set(x * cs, vy * cs);
        sp.visible = true;
      });
    } else {
      for (const sp of this.ghostSprites) sp.visible = false;
    }

    // Garbage bar
    if (this.garbageBarSprite) {
      const barH = snapshot.pendingGarbage > 0
        ? Math.min(this.boardH * 0.42, snapshot.pendingGarbage * cs * 0.42)
        : 0;
      this.garbageBarSprite.height = barH;
      this.garbageBarSprite.y = this.boardH - barH;
    }
  }

  private tickEffects(): void {
    const now = performance.now();
    const anim = this.animState;

    // Shake
    if (this.boardContainer) {
      if (anim.shakeUntil > now) {
        const progress = (anim.shakeUntil - now) / 220;
        const offset = Math.sin(now / 22) * anim.shakeStrength * 7 * progress;
        this.boardContainer.x = offset;
        this.boardContainer.y = Math.abs(offset) * 0.28;
      } else {
        this.boardContainer.x = 0;
        this.boardContainer.y = 0;
      }
    }

    // Clear flash (white)
    if (this.clearFlashOverlay) {
      const p = Math.max(0, anim.clearFlashUntil - now) / 420;
      this.clearFlashOverlay.alpha = p * anim.clearFlashStrength * 0.38;
    }

    // Lock flash (piece color)
    if (this.lockFlashOverlay) {
      const p = Math.max(0, anim.lockFlashUntil - now) / 130;
      this.lockFlashOverlay.tint = anim.lockFlashColor as unknown as string;
      this.lockFlashOverlay.alpha = p * 0.28;
    }

    // Danger pulse
    if (this.dangerOverlay) {
      if (anim.dangerActive) {
        this.dangerOverlay.alpha = 0.14 + Math.sin(now / 820) * 0.07;
      } else if (this.dangerOverlay.alpha > 0) {
        this.dangerOverlay.alpha = Math.max(0, this.dangerOverlay.alpha - 0.015);
      }
    }

    // Top-out darkening
    if (this.topOutOverlay) {
      if (anim.topOut) {
        this.topOutOverlay.alpha = Math.min(0.78, this.topOutOverlay.alpha + 0.018);
      } else if (this.topOutOverlay.alpha > 0) {
        this.topOutOverlay.alpha = 0;
      }
    }
  }

  destroy(): void {
    this.textures.destroy();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }
}
