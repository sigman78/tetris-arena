export const PORT = Number(process.env.PORT ?? 2567);
export const BIND_HOST = process.env.BIND_HOST ?? "0.0.0.0";
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

export function getAllowedOrigins(): string[] {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Returns true when the origin should be permitted.
 *  Set CORS_ORIGIN="*" to allow all origins (useful for LAN play). */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const list = getAllowedOrigins();
  return list.includes("*") || list.includes(origin);
}
