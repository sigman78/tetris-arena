import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  HIDDEN_ROWS,
  PIECES,
  VISIBLE_ROWS,
  type BoardSnapshot,
  type CellValue,
  type PieceType
} from "@tetris-arena/shared";

const COLORS: Record<Exclude<CellValue, null>, string> = {
  I: "#39d0ff",
  J: "#4e7bff",
  L: "#ffad33",
  O: "#ffe45c",
  S: "#58d68d",
  T: "#bc7dff",
  Z: "#ff5d73",
  garbage: "#546577"
};

export interface BoardRenderState {
  clearFlashUntil: number;
  clearFlashStrength: number;
  garbageFlashUntil: number;
  garbageFlashStrength: number;
  shakeUntil: number;
  shakeStrength: number;
  previousLines: number;
  previousGarbageCells: number;
}

export function createBoardRenderState(): BoardRenderState {
  return {
    clearFlashUntil: 0,
    clearFlashStrength: 0,
    garbageFlashUntil: 0,
    garbageFlashStrength: 0,
    shakeUntil: 0,
    shakeStrength: 0,
    previousLines: 0,
    previousGarbageCells: 0
  };
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  snapshot: BoardSnapshot,
  state: BoardRenderState
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const now = performance.now();
  const linesDelta = snapshot.linesClearedTotal - state.previousLines;
  if (linesDelta > 0) {
    state.clearFlashUntil = now + 260;
    state.clearFlashStrength = Math.min(1, 0.42 + linesDelta * 0.14);
    state.shakeUntil = Math.max(state.shakeUntil, now + 170);
    state.shakeStrength = Math.max(state.shakeStrength, 0.18 + linesDelta * 0.06);
  }
  state.previousLines = snapshot.linesClearedTotal;

  const garbageCells = countGarbageCells(snapshot.board);
  const garbageDelta = garbageCells - state.previousGarbageCells;
  if (garbageDelta >= BOARD_WIDTH / 2) {
    state.garbageFlashUntil = now + 320;
    state.garbageFlashStrength = Math.min(1, 0.35 + garbageDelta / (BOARD_WIDTH * 3));
    state.shakeUntil = Math.max(state.shakeUntil, now + 220);
    state.shakeStrength = Math.max(state.shakeStrength, 0.24 + garbageDelta / (BOARD_WIDTH * 8));
  }
  state.previousGarbageCells = garbageCells;

  const { width, height } = syncCanvasSize(canvas, context);
  context.clearRect(0, 0, width, height);

  const remainingShake = Math.max(0, state.shakeUntil - now);
  const shakeProgress = state.shakeUntil > now ? remainingShake / 220 : 0;
  const shakeOffset = shakeProgress > 0 ? Math.sin(now / 24) * state.shakeStrength * 9 * shakeProgress : 0;

  context.save();
  context.translate(shakeOffset, Math.abs(shakeOffset) * 0.35);

  const cellSize = width / BOARD_WIDTH;
  context.fillStyle = "#031018";
  context.fillRect(0, 0, width, height);

  for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow += 1) {
    const row = snapshot.board[visibleRow + HIDDEN_ROWS]!;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      drawCell(context, x, visibleRow, row[x] ?? null, cellSize);
    }
  }

  drawGhostPiece(context, snapshot, cellSize);

  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    context.beginPath();
    context.moveTo(x * cellSize, 0);
    context.lineTo(x * cellSize, height);
    context.stroke();
  }

  for (let y = 0; y <= VISIBLE_ROWS; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cellSize);
    context.lineTo(width, y * cellSize);
    context.stroke();
  }

  if (snapshot.pendingGarbage > 0) {
    const pendingHeight = Math.min(height * 0.18, snapshot.pendingGarbage * cellSize * 0.25);
    const warning = context.createLinearGradient(0, height - pendingHeight, 0, height);
    warning.addColorStop(0, "rgba(255, 149, 0, 0)");
    warning.addColorStop(1, "rgba(255, 149, 0, 0.24)");
    context.fillStyle = warning;
    context.fillRect(0, height - pendingHeight, width, pendingHeight);
  }

  const clearProgress = Math.max(0, state.clearFlashUntil - now) / 260;
  if (clearProgress > 0) {
    const alpha = clearProgress * state.clearFlashStrength * 0.38;
    context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    context.fillRect(0, 0, width, height);
  }

  const garbageProgress = Math.max(0, state.garbageFlashUntil - now) / 320;
  if (garbageProgress > 0) {
    const alpha = garbageProgress * state.garbageFlashStrength * 0.54;
    const flash = context.createLinearGradient(0, height, 0, Math.max(0, height - cellSize * 5));
    flash.addColorStop(0, `rgba(255, 109, 59, ${alpha.toFixed(3)})`);
    flash.addColorStop(1, "rgba(255, 109, 59, 0)");
    context.fillStyle = flash;
    context.fillRect(0, Math.max(0, height - cellSize * 5), width, cellSize * 5);
  }

  context.restore();
}

export function renderPiecePreview(label: string, piece: PieceType | null, locked = false): string {
  const cells = piece ? getPreviewCells(piece) : [];
  return `
    <section class="piece-panel${locked ? " piece-panel--locked" : ""}">
      <span class="piece-label">${label}</span>
      <div class="piece-preview" aria-label="${label}">
        ${Array.from({ length: 16 }, (_, index) => {
          const occupied = cells.includes(index);
          const color = piece ? getPieceColor(piece) : "transparent";
          return `<span class="piece-preview-cell${occupied ? " filled" : ""}" style="${occupied ? `--piece-color:${color}` : ""}"></span>`;
        }).join("")}
      </div>
      <strong class="piece-code">${piece ?? "—"}</strong>
    </section>
  `;
}

function drawGhostPiece(
  context: CanvasRenderingContext2D,
  snapshot: BoardSnapshot,
  cellSize: number
): void {
  const { active, board } = snapshot;
  if (!active) return;

  const shape = PIECES[active.type][active.rotation]!;
  const activeCells = shape.map((c) => ({ x: active.x + c.x, y: active.y + c.y }));
  const activeCellKeys = new Set(activeCells.map((c) => `${c.x},${c.y}`));

  // Find how far down the piece can drop
  let delta = 0;
  while (true) {
    const nextDelta = delta + 1;
    const wouldCollide = activeCells.some(({ x, y }) => {
      const ny = y + nextDelta;
      if (ny >= BOARD_HEIGHT) return true;
      if (ny < 0) return false;
      const cell = board[ny]?.[x];
      return cell !== null && !activeCellKeys.has(`${x},${ny}`);
    });
    if (wouldCollide) break;
    delta = nextDelta;
  }

  if (delta === 0) return; // piece already on the floor, ghost = active

  const color = COLORS[active.type];
  // Parse hex to rgb for rgba() usage
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  for (const { x, y } of activeCells) {
    const ghostY = y + delta;
    const visibleY = ghostY - HIDDEN_ROWS;
    if (visibleY < 0 || visibleY >= VISIBLE_ROWS) continue;

    const px = x * cellSize;
    const py = visibleY * cellSize;
    const inner = Math.max(1, cellSize - 2);

    context.save();
    context.globalAlpha = 0.18;
    context.fillStyle = color;
    context.fillRect(px + 1, py + 1, inner, inner);
    context.globalAlpha = 0.55;
    context.strokeStyle = `rgb(${r},${g},${b})`;
    context.lineWidth = 1;
    context.strokeRect(px + 1.5, py + 1.5, Math.max(1, cellSize - 3), Math.max(1, cellSize - 3));
    context.restore();
  }
}

function drawCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: CellValue,
  cellSize: number
): void {
  const px = x * cellSize;
  const py = y * cellSize;

  context.fillStyle = "rgba(255,255,255,0.03)";
  context.fillRect(px, py, cellSize, cellSize);

  if (!value) {
    return;
  }

  context.fillStyle = COLORS[value];
  context.fillRect(px + 1, py + 1, Math.max(1, cellSize - 2), Math.max(1, cellSize - 2));
  context.fillStyle = "rgba(255,255,255,0.22)";
  context.fillRect(px + cellSize * 0.16, py + cellSize * 0.14, cellSize * 0.5, Math.max(2, cellSize * 0.1));
}

function syncCanvasSize(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): { width: number; height: number } {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const targetWidth = Math.floor(width * pixelRatio);
  const targetHeight = Math.floor(height * pixelRatio);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

function countGarbageCells(board: CellValue[][]): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === "garbage") {
        count += 1;
      }
    }
  }
  return count;
}

function getPreviewCells(piece: PieceType): number[] {
  return PIECES[piece][0]!.map(({ x, y }) => y * 4 + x);
}

function getPieceColor(piece: PieceType): string {
  return COLORS[piece];
}
