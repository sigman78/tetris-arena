export const PORT = Number(process.env.PORT ?? 2567);
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173";
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

export function getAllowedOrigins(): string[] {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
