<script lang="ts">
  import PlayerPanel from '../components/PlayerPanel.svelte';
  import Leaderboard from '../components/Leaderboard.svelte';
</script>

<main class="shell">
  <section class="hero">
    <div class="panel stack">
      <PlayerPanel />
    </div>
    <div class="panel">
      <Leaderboard />
    </div>
  </section>
</main>
