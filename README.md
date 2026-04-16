# Tetris Arena

Browser-based PvP Tetris with a Vite TypeScript client, a Colyseus multiplayer server, and a shared gameplay engine.
Leaderboard ranking is based on each player's best single-match score, with wins and games played shown as secondary stats.

## Workspace
- `packages/shared`: pure Tetris engine, shared protocol/types, and engine tests
- `packages/server`: Colyseus rooms, matchmaking, leaderboard API, Prisma/SQLite persistence
- `packages/client`: browser lobby and match UI rendered with Canvas 2D

## Run
1. Install dependencies:
```bash
npm install
```
2. Set up the server env:
```bash
copy packages\\server\\.env.example packages\\server\\.env
```
3. Create the SQLite database:
```bash
npm run db:push -w @tetris-arena/server
```
If you pull schema changes later, run `npm run db:push -w @tetris-arena/server` again to update the local SQLite file.
4. Start the workspace:
```bash
npm run dev
```

Client defaults to `http://localhost:5173` and server defaults to `http://localhost:2567`.

## Scripts
- `npm run dev`: shared build watcher + Colyseus server + Vite client
- `npm run build`: full workspace build
- `npm test`: shared and server tests
