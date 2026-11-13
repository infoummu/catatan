import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { normalizeVaultName } from "@/lib/vault-server";

/**
 * GET /api/vaults/[name]
 * Ambil salt publik milik vault, dipakai klien untuk menurunkan kunci.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json({ error: "Tidak didukung" }, { status: 501 });
    }

    const clientIp = getClientIp(request);
    const limit = checkRateLimit(clientIp, "lookup_vault", RATE_LIMITS.LOOKUP_VAULT);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const { name } = await params;
    const vaultName = normalizeVaultName(name);
    if (!vaultName) {
      return NextResponse.json({ error: "Nama tidak valid" }, { status: 400 });
    }

    const row = sqlite
      .prepare("SELECT salt FROM vaults WHERE name = ?")
      .get(vaultName) as { salt: string } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Akun tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({ name: vaultName, salt: row.salt });
  } catch (error) {
    console.error("Error lookup vault:", error);
    return NextResponse.json({ error: "Gagal memuat akun" }, { status: 500 });
  }
}
