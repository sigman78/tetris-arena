<script lang="ts">
  import { connectedPlayers, activeGames, gamesPlayedSinceStart, avgWaitMs, ping, queueStatus } from '../stores/lobby.js';
  import { formatDuration } from '../utils/format.js';
</script>

<div class="lobby-stats">
  <div>
    <div class="stat-label">ONLINE</div>
    <div class="stat-value">{$connectedPlayers ?? '—'}</div>
  </div>
  <div>
    <div class="stat-label">ACTIVE GAMES</div>
    <div class="stat-value">{$activeGames ?? '—'}</div>
  </div>
  <div>
    <div class="stat-label">GAMES PLAYED</div>
    <div class="stat-value">{$gamesPlayedSinceStart ?? '—'}</div>
  </div>
  <div>
    <div class="stat-label">IN QUEUE</div>
    <div class="stat-value">{$queueStatus.queueSize}</div>
  </div>
  <div>
    <div class="stat-label">AVG WAIT</div>
    <div class="stat-value">{$avgWaitMs > 0 ? formatDuration($avgWaitMs) : '—'}</div>
  </div>
  <div>
    <div class="stat-label">PING</div>
    <div class="stat-value">{$ping !== null ? `${$ping}ms` : '—'}</div>
  </div>
</div>

<style>
  .lobby-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 1.2rem;
  }
</style>
