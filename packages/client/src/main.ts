import './styles/global.css';
import './styles/animations.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { connectLobby } from './services/colyseus.js';

const app = mount(App, {
  target: document.getElementById('app')!,
});

void connectLobby();

export default app;
