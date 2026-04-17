import type { InputAction } from "@tetris-arena/shared";

export function mapKeyToAction(key: string): InputAction | null {
  switch (key) {
    case "ArrowLeft":  return "moveLeft";
    case "ArrowRight": return "moveRight";
    case "ArrowDown":  return "softDrop";
    case " ":          return "hardDrop";
    case "x": case "X": case "ArrowUp": return "rotateCW";
    case "z": case "Z": return "rotateCCW";
    case "Shift": case "c": case "C": return "hold";
    default: return null;
  }
}

export function formatScore(value: number): string {
  return value.toLocaleString();
}

export function formatMatchTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
