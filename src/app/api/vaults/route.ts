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
 * POST /api/vaults
 * Buat "akun" (vault) baru. Server hanya menerima salt + verifier;
 * passphrase tidak pernah dikirim.
 */
export async function POST(request: NextRequest) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json(
        { error: "Akun hanya tersedia pada backend SQLite" },
        { status: 501 },
      );
    }

    const clientIp = getClientIp(request);
    const limit = checkRateLimit(clientIp, "create_vault", RATE_LIMITS.CREATE_VAULT);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const body = await request.json();
    const name = normalizeVaultName(body?.name);
    const salt = body?.salt;
    const verifier = body?.verifier;

    if (!name) {
      return NextResponse.json(
        { error: "Nama 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau strip" },
        { status: 400 },
      );
    }
    if (typeof salt !== "string" || salt.length < 16 || salt.length > 128) {
      return NextResponse.json({ error: "Salt tidak valid" }, { status: 400 });
    }
    if (typeof verifier !== "string" || verifier.length < 32 || verifier.length > 128) {
      return NextResponse.json({ error: "Verifier tidak valid" }, { status: 400 });
    }

    try {
      sqlite
        .prepare(
          "INSERT INTO vaults (name, salt, verifier, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(name, salt, verifier, Date.now());
    } catch (error: any) {
      if (String(error?.code || "").includes("SQLITE_CONSTRAINT")) {
        return NextResponse.json(
          { error: "Nama sudah dipakai. Pilih nama lain." },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({ name }, { status: 201 });
  } catch (error) {
    console.error("Error creating vault:", error);
    return NextResponse.json({ error: "Gagal membuat akun" }, { status: 500 });
  }
}
