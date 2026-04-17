<script lang="ts">
  import { leaderboard } from '../stores/lobby.js';
  import { nickname } from '../stores/app.js';
  import { formatScore } from '../utils/format.js';

  const medals = ["🥇", "🥈", "🥉"];
</script>

<div class="panel">
<div class="lobby-records-header">
  <div>
    <h2 class="lobby-records-title">Arena Records</h2>
    <p class="muted" style="margin:0.15rem 0 0;font-size:0.8rem">Ranked by best match score</p>
  </div>
  <div class="status-pill">Top {$leaderboard.length}</div>
</div>

<table class="leaderboard">
  <thead>
    <tr>
      <th>#</th><th>Player</th><th>Score</th><th>W</th><th>L</th><th>Win%</th>
    </tr>
  </thead>
  <tbody>
    {#if $leaderboard.length > 0}
      {#each $leaderboard as entry, i}
        {@const losses = entry.gamesPlayed - entry.wins}
        {@const pct = entry.gamesPlayed > 0 ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0}
        {@const pctStyle = pct >= 60 ? `color:var(--accent)` : (pct <= 35 && entry.gamesPlayed > 0 ? `color:var(--danger)` : '')}
        {@const isMe = entry.nickname === $nickname.trim()}
        {@const rank = i < 3 ? medals[i] : String(i + 1)}
        <tr class={isMe ? 'leaderboard-me' : ''}>
          <td>{rank}</td>
          <td>{entry.nickname}</td>
          <td class="stat-value" style="font-size:0.85rem">{formatScore(entry.bestScore)}</td>
          <td>{entry.wins}</td>
          <td>{losses}</td>
          <td style={pctStyle}>{entry.gamesPlayed > 0 ? `${pct}%` : '—'}</td>
        </tr>
      {/each}
    {:else}
      <tr>
        <td colspan="6" class="muted" style="text-align:center;padding:1.5rem 0">No matches recorded yet.</td>
      </tr>
    {/if}
  </tbody>
</table>
</div>

<style>
  .lobby-records-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .lobby-records-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 2px;
    padding: 0.45rem 0.8rem;
    background: rgba(0, 245, 255, 0.06);
    border: 1px solid rgba(0, 245, 255, 0.12);
    color: var(--text);
    font-size: 0.8rem;
    letter-spacing: 0.06em;
  }

  .leaderboard {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  .leaderboard :global(th),
  .leaderboard :global(td) {
    padding: 0.7rem 0.35rem;
    text-align: left;
    border-bottom: 1px solid rgba(0, 245, 255, 0.07);
  }

  .leaderboard :global(th) {
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  :global(.leaderboard-me) :global(td) {
    background: rgba(0, 245, 255, 0.05);
  }

  :global(.leaderboard-me) :global(td:first-child) {
    border-left: 2px solid var(--accent);
  }
</style>
