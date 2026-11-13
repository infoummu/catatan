import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getDb } from "@/db";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  normalizeVaultName,
  createSessionToken,
  hashSessionToken,
  SESSION_TTL_MS,
} from "@/lib/vault-server";

/**
 * POST /api/vaults/[name]/login
 * Verifikasi klaim passphrase (verifier turunan) lalu beri token sesi.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json({ error: "Tidak didukung" }, { status: 501 });
    }

    const clientIp = getClientIp(request);
    const limit = checkRateLimit(clientIp, "login_vault", RATE_LIMITS.LOGIN_VAULT);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const { name } = await params;
    const vaultName = normalizeVaultName(name);
    if (!vaultName) {
      return NextResponse.json({ error: "Nama tidak valid" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const verifier = body?.verifier;
    if (typeof verifier !== "string" || !verifier) {
      return NextResponse.json({ error: "Verifier wajib diisi" }, { status: 400 });
    }

    const row = sqlite
      .prepare("SELECT verifier FROM vaults WHERE name = ?")
      .get(vaultName) as { verifier: string } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Nama atau passphrase salah" }, { status: 401 });
    }

    const a = Buffer.from(row.verifier, "utf8");
    const b = Buffer.from(verifier, "utf8");
    const match = a.length === b.length && timingSafeEqual(a, b);

    if (!match) {
      return NextResponse.json({ error: "Nama atau passphrase salah" }, { status: 401 });
    }

    // Bersihkan sesi kedaluwarsa sekalian
    const now = Date.now();
    sqlite.prepare("DELETE FROM vault_sessions WHERE expires_at <= ?").run(now);

    const token = createSessionToken();
    sqlite
      .prepare(
        "INSERT INTO vault_sessions (token_hash, vault_name, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(hashSessionToken(token), vaultName, now, now + SESSION_TTL_MS);

    return NextResponse.json({ name: vaultName, token });
  } catch (error) {
    console.error("Error login vault:", error);
    return NextResponse.json({ error: "Gagal masuk" }, { status: 500 });
  }
}
