import { writable } from 'svelte/store';
import type { MatchSnapshot, MatchResultPayload } from '@tetris-arena/shared';

export const matchSnapshot = writable<MatchSnapshot | null>(null);
export const matchResult = writable<MatchResultPayload | null>(null);

export function resetMatch(): void {
  matchSnapshot.set(null);
  matchResult.set(null);
}
