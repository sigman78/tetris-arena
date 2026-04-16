# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install
npm install

# First-time DB setup (SQLite via Prisma)
npm run db:push -w @tetris-arena/server

# Development (all three packages in parallel)
npm run dev

# Build all packages (shared → server → client)
npm run build

# Tests (shared engine + server simulation)
npm test

# Run tests for a single package
npm run test -w @tetris-arena/shared
npm run test -w @tetris-arena/server

# DB schema changes
npm run db:push -w @tetris-arena/server
```

URLs: client `http://localhost:5173`, server `http://localhost:2567`.

Server env: copy `packages/server/.env.example` to `packages/server/.env` before first run.

## Architecture

**Monorepo with three npm workspaces:**

- `packages/shared` — pure TypeScript engine, protocol types, and scoring logic. No runtime deps. Built with `tsc`, consumed by both server and client via `@tetris-arena/shared`. Must be built first.
- `packages/server` — Colyseus WebSocket server + Express HTTP layer. Uses `tsx watch` in dev (no compile step). Prisma/SQLite for persistence.
- `packages/client` — Vite SPA. Canvas 2D rendering. No framework — all DOM manipulation is manual via `innerHTML` and `querySelector`.

**Game loop flow:**

1. Client connects to `LobbyRoom` (Colyseus) and enters the matchmaking queue.
2. `lobbyService` pairs two players and creates a `MatchRoom`, sending each client a `SeatReservation` via `match:found`.
3. Client leaves `LobbyRoom` and joins `MatchRoom` using the reservation.
4. `MatchRoom` runs `MatchSimulation.tick()` every 33 ms (`setSimulationInterval`). Clients send `game:input` messages; the server applies them via `applyInputAction` from shared, then ticks gravity/lock timers via `tickPlayerState`.
5. On piece lock, `resolveCombat` cross-cancels garbage and calls `finalizeAfterLock`. The server broadcasts `game:snapshot` to both clients each tick.
6. When a player tops out, `MatchRoom` broadcasts `game:result` and persists the outcome via `leaderboardService.recordMatch`.

**Shared engine key functions** (`packages/shared/src/engine.ts`):
- `createPlayerState(seed)` — initialises a fresh `InternalPlayerState`.
- `applyInputAction(state, action)` — mutates state in place; returns `GameplayResolution | null` on piece lock.
- `tickPlayerState(state, deltaMs)` — advances gravity and lock timers; returns `GameplayResolution | null` on lock.
- `finalizeAfterLock(state)` — applies queued garbage then spawns next piece; call after lock resolution.
- `getBoardSnapshot(state)` — returns a `BoardSnapshot` (safe to send over the wire).

**Protocol** (`packages/shared/src/protocol.ts`): `LOBBY_MESSAGES` and `MATCH_MESSAGES` are the string-keyed message type constants shared between server rooms and the client.

**Persistence:** `LeaderboardService` (`packages/server/src/services/leaderboard.ts`) upserts `PlayerRecord` rows keyed on `normalizedNickname` (lowercased). Ranking is by `bestScore` desc, then `wins` desc.

**Client rendering:** `packages/client/src/renderer.ts` handles Canvas 2D board drawing. `main.ts` owns all state, view switching, Colyseus message handlers, and the `requestAnimationFrame` loop for the match view.

## Test locations

Tests live under `packages/shared/test/` and `packages/server/test/`, not co-located with source. Test runner is Vitest.
