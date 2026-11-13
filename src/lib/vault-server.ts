import { createHash, randomBytes } from "crypto";
import { getDb } from "@/db";

/** Hash token sesi — yang disimpan di database hanya hash-nya */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

/**
 * Nama vault dari header `Authorization: Bearer <token>`.
 * Null bila token tidak ada, kedaluwarsa, atau tidak dikenal.
 */
export function getVaultName(request: Request): string | null {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const { sqlite } = getDb();
  if (!sqlite) return null;

  const tokenHash = hashSessionToken(match[1].trim());
  const row = sqlite
    .prepare("SELECT vault_name, expires_at FROM vault_sessions WHERE token_hash = ?")
    .get(tokenHash) as { vault_name: string; expires_at: number } | undefined;

  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    sqlite.prepare("DELETE FROM vault_sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  return row.vault_name;
}

export function normalizeVaultName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) return null;
  return name;
}
