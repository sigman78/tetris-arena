import { Texture } from "pixi.js";
import type { CellValue, PieceType } from "@tetris-arena/shared";

export type CellKind = NonNullable<CellValue> | `ghost_${PieceType}` | "empty";

export const NEON_COLORS: Record<string, string> = {
  I: "#00f5ff",
  J: "#3d6fff",
  L: "#ff8c00",
  O: "#ffd700",
  S: "#39ff14",
  T: "#bf5fff",
  Z: "#ff2442",
  garbage: "#445566"
};

export class CellTextureCache {
  private cache = new Map<string, Texture>();

  get(kind: CellKind, cellSize: number): Texture {
    const key = `${kind}_${cellSize}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, buildTexture(kind, cellSize));
    }
    return this.cache.get(key)!;
  }

  destroy(): void {
    for (const texture of this.cache.values()) {
      texture.destroy(true);
    }
    this.cache.clear();
  }
}

function buildTexture(kind: CellKind, size: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const isGhost = kind.startsWith("ghost_");
  const baseType = isGhost ? kind.slice(6) : kind;
  const color = NEON_COLORS[baseType] ?? "#445566";

  if (kind === "empty") {
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fillRect(size / 2 - 1, size / 2 - 1, 2, 2);
  } else if (isGhost) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(2, 2, size - 4, size - 4);
  } else {
    // Base fill
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, size - 4, size - 4);

    // Top-left highlight bevel
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(2, 2, size - 4, Math.max(3, Math.floor(size * 0.14)));
    ctx.fillRect(2, 2, Math.max(3, Math.floor(size * 0.14)), size - 4);

    // Bottom-right shadow bevel
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(2, size - 5, size - 4, 3);
    ctx.fillRect(size - 5, 2, 3, size - 4);

    // Neon outer glow pass
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.5;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, size - 4, size - 4);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  return Texture.from(canvas);
}
