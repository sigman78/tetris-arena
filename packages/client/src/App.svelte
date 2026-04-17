<script lang="ts">
  import { view } from './stores/app.js';
  import LobbyView from './views/LobbyView.svelte';
  import MatchView from './views/MatchView.svelte';
</script>

{#if $view === 'lobby'}
  <LobbyView />
{:else}
  <MatchView />
{/if}
