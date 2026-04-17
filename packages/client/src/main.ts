import './styles/global.css';
import './styles/animations.css';
import App from './App.svelte';
import { connectLobby } from './services/colyseus.js';

const app = new App({
  target: document.getElementById('app')!,
});

void connectLobby();

export default app;
