import { writable } from 'svelte/store';

export type AppView = 'lobby' | 'match';

export const view = writable<AppView>('lobby');
export const nickname = writable<string>(localStorage.getItem('nickname') ?? '');

// Keep nickname in sync with localStorage
nickname.subscribe(val => localStorage.setItem('nickname', val));
