import type { PieceType } from "./types.js";

const PIECE_BAG: PieceType[] = ["I", "J", "L", "O", "S", "T", "Z"];

export function nextRandom(state: number): [number, number] {
  let seed = state | 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, seed];
}

export function createSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export function shuffleBag(seed: number): [PieceType[], number] {
  const bag = [...PIECE_BAG];
  let rngState = seed;

  for (let index = bag.length - 1; index > 0; index -= 1) {
    const [value, nextSeed] = nextRandom(rngState);
    rngState = nextSeed;
    const swapIndex = Math.floor(value * (index + 1));
    const current = bag[index];
    bag[index] = bag[swapIndex]!;
    bag[swapIndex] = current!;
  }

  return [bag, rngState];
}
