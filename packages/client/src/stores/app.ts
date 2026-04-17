import { writable } from 'svelte/store';

export type AppView = 'lobby' | 'match';

export const view = writable<AppView>('lobby');
export const nickname = writable<string>(localStorage.getItem('tetris-arena:nickname') ?? '');

// Keep nickname in sync with localStorage
nickname.subscribe(val => {
  if (val) localStorage.setItem('tetris-arena:nickname', val);
  else localStorage.removeItem('tetris-arena:nickname');
});
