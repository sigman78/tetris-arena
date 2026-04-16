import { LEADERBOARD_LIMIT, type LeaderboardEntry } from "@tetris-arena/shared";
import { prisma } from "../db.js";

function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

function toEntry(record: {
  nickname: string;
  bestScore: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  updatedAt: Date;
}): LeaderboardEntry {
  return {
    nickname: record.nickname,
    bestScore: record.bestScore,
    wins: record.wins,
    losses: record.losses,
    gamesPlayed: record.gamesPlayed,
    updatedAt: record.updatedAt.toISOString()
  };
}

export class LeaderboardService {
  async getTop(limit = LEADERBOARD_LIMIT): Promise<LeaderboardEntry[]> {
    const rows = await prisma.playerRecord.findMany({
      orderBy: [{ bestScore: "desc" }, { wins: "desc" }, { updatedAt: "asc" }],
      take: limit
    });

    return rows.map(toEntry);
  }

  async recordMatch(
    winnerNickname: string,
    loserNickname: string,
    winnerScore: number,
    loserScore: number
  ): Promise<void> {
    const winner = winnerNickname.trim();
    const loser = loserNickname.trim();
    const winnerKey = normalizeNickname(winner);
    const loserKey = normalizeNickname(loser);
    const [winnerExisting, loserExisting] = await prisma.$transaction([
      prisma.playerRecord.findUnique({ where: { normalizedNickname: winnerKey } }),
      prisma.playerRecord.findUnique({ where: { normalizedNickname: loserKey } })
    ]);

    await prisma.$transaction([
      prisma.playerRecord.upsert({
        where: { normalizedNickname: winnerKey },
        update: {
          nickname: winner,
          bestScore: { set: Math.max(winnerExisting?.bestScore ?? 0, winnerScore) },
          wins: { increment: 1 },
          gamesPlayed: { increment: 1 }
        },
        create: {
          nickname: winner,
          normalizedNickname: winnerKey,
          bestScore: winnerScore,
          wins: 1,
          losses: 0,
          gamesPlayed: 1
        }
      }),
      prisma.playerRecord.upsert({
        where: { normalizedNickname: loserKey },
        update: {
          nickname: loser,
          bestScore: { set: Math.max(loserExisting?.bestScore ?? 0, loserScore) },
          losses: { increment: 1 },
          gamesPlayed: { increment: 1 }
        },
        create: {
          nickname: loser,
          normalizedNickname: loserKey,
          bestScore: loserScore,
          wins: 0,
          losses: 1,
          gamesPlayed: 1
        }
      })
    ]);
  }
}

export const leaderboardService = new LeaderboardService();
