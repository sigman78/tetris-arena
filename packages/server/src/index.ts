import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { LEADERBOARD_LIMIT } from "@tetris-arena/shared";
import { PORT, getAllowedOrigins } from "./config.js";
import { prisma } from "./db.js";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { MatchRoom } from "./rooms/MatchRoom.js";
import { leaderboardService } from "./services/leaderboard.js";

const allowedOrigins = getAllowedOrigins();
const httpServer = createServer();

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true
};

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    verifyClient: (info, callback) => {
      const origin = info.origin;
      if (!origin || allowedOrigins.includes(origin)) {
        callback(true);
        return;
      }

      callback(false, 403, "Origin not allowed");
    }
  }),
  beforeListen: async () => {
    await prisma.$connect();
  },
  express: (app) => {
    app.use(cors(corsOptions));
    app.options("*", cors(corsOptions));
    app.use(express.json());

    app.get("/health", (_request, response) => {
      response.json({ ok: true });
    });

    app.get("/leaderboard", async (_request, response, next) => {
      try {
        response.json(await leaderboardService.getTop(LEADERBOARD_LIMIT));
      } catch (error) {
        next(error);
      }
    });

    app.use(
      (error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
        if (response.headersSent) {
          next(error);
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        response.status(500).json({ message });
      }
    );
  }
});

gameServer.define("lobby", LobbyRoom);
gameServer.define("match", MatchRoom);

void gameServer.listen(PORT).then(() => {
  console.log(`Tetris Arena server listening on http://localhost:${PORT}`);
}).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

async function shutdown(code = 0): Promise<void> {
  await gameServer.gracefullyShutdown(false);
  await prisma.$disconnect();
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(0).catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown(0).catch(() => process.exit(1));
});
