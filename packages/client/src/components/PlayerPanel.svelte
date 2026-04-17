<script lang="ts">
  import { nickname } from '../stores/app.js';
  import { lobbyConnected, queueStatus, lobbyError } from '../stores/lobby.js';
  import { sendJoinQueue, sendLeaveQueue, connectLobby } from '../services/colyseus.js';
  import QueueStatus from './QueueStatus.svelte';
  import ServerStats from './ServerStats.svelte';

  function handleJoinQueue() {
    const nick = $nickname.trim();
    if (!nick) {
      lobbyError.set('Choose a callsign before joining the queue.');
      return;
    }
    lobbyError.set(null);
    sendJoinQueue(nick);
  }

  function handleLeaveQueue() {
    sendLeaveQueue();
  }

  async function handleRetry() {
    lobbyError.set(null);
    try {
      await connectLobby();
    } catch (err) {
      lobbyError.set(err instanceof Error ? err.message : 'Connection failed.');
    }
  }
</script>

<div class="panel stack">
  <div class="lobby-brand">
    <p class="stat-label" style="margin:0 0 0.4rem">ONLINE PVP · KEYBOARD</p>
    <h1 class="title">Tetris<br>Arena</h1>
    <p class="muted" style="margin-top:0.4rem;font-size:0.82rem;letter-spacing:0.04em">
      Clear lines, pressure your opponent, survive the garbage war.
    </p>
  </div>

  <div class="stack lobby-setup">
    <div class="stat-label">CALLSIGN</div>
    <input
      maxlength="18"
      placeholder="Enter your callsign…"
      value={$nickname}
      on:input={e => nickname.set(e.currentTarget.value)}
    />
  </div>

  <div class="stack" style="gap:0.55rem">
    <div class="row">
      <button
        class="primary"
        disabled={$queueStatus.inQueue || !$lobbyConnected}
        on:click={handleJoinQueue}
      >
        {$queueStatus.inQueue ? 'SEARCHING…' : 'FIND MATCH'}
      </button>
      <button
        class="secondary"
        disabled={!$queueStatus.inQueue}
        on:click={handleLeaveQueue}
      >
        LEAVE
      </button>
    </div>
    <QueueStatus on:retry={handleRetry} />
  </div>

  <div class="lobby-meta">
    <ServerStats />
    <div class="lobby-keys">
      <div class="stat-label" style="margin-bottom:0.4rem">CONTROLS</div>
      <div class="controls">
        <span>Move ←→</span>
        <span>Rotate X / Z</span>
        <span>Soft drop ↓</span>
        <span>Hard drop Space</span>
        <span>Hold Shift / C</span>
      </div>
    </div>
  </div>
</div>

<style>
  .lobby-setup {
    gap: 0.4rem !important;
  }

  .lobby-meta {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem 1rem;
    color: var(--muted);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
  }

  .title {
    font-size: clamp(2rem, 6vw, 4.2rem);
    font-weight: 900;
    line-height: 0.9;
    margin: 0 0 0.5rem;
    color: #fff;
    text-shadow:
      0 0 12px rgba(0, 245, 255, 0.5),
      0 0 40px rgba(0, 245, 255, 0.2);
    letter-spacing: 0.04em;
  }
</style>
