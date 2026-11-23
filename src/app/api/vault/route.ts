import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getVaultName } from "@/lib/vault-server";

export const runtime = "nodejs";

type VaultItem = {
  docId: string;
  wrappedKey: string;
  wrappedToken: string | null;
  title: string | null;
  updatedAt: number;
  deleted?: boolean;
};

/** GET /api/vault — daftar item (kunci terbungkus) milik vault yang login */
export async function GET(request: NextRequest) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json({ error: "Tidak didukung" }, { status: 501 });
    }

    const limit = checkRateLimit(getClientIp(request), "vault_sync", RATE_LIMITS.VAULT_SYNC);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const vaultName = getVaultName(request);
    if (!vaultName) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    }

    // Klien lama tidak mengirim includeDeleted, jadi mereka tetap menerima
    // daftar aktif saja. Klien baru meminta tombstone sekalian agar bisa
    // menghapus catatan yang sudah dihapus dari perangkat lain.
    const includeDeleted =
      request.nextUrl.searchParams.get("includeDeleted") === "1";

    const rows = sqlite
      .prepare(
        `SELECT doc_id, wrapped_key, wrapped_token, title, updated_at, deleted
         FROM vault_items WHERE vault_name = ?${
           includeDeleted ? "" : " AND deleted = 0"
         } ORDER BY updated_at DESC`,
      )
      .all(vaultName) as any[];

    const items: VaultItem[] = rows.map((r) => ({
      docId: r.doc_id,
      wrappedKey: r.wrapped_key,
      wrappedToken: r.wrapped_token ?? null,
      title: r.title ?? null,
      updatedAt: r.updated_at,
      ...(includeDeleted ? { deleted: Boolean(r.deleted) } : {}),
    }));

    return NextResponse.json({ name: vaultName, items });
  } catch (error) {
    console.error("Error list vault:", error);
    return NextResponse.json({ error: "Gagal memuat daftar" }, { status: 500 });
  }
}

/** PUT /api/vault — tambah/perbarui satu item */
export async function PUT(request: NextRequest) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json({ error: "Tidak didukung" }, { status: 501 });
    }

    const limit = checkRateLimit(getClientIp(request), "vault_sync", RATE_LIMITS.VAULT_SYNC);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const vaultName = getVaultName(request);
    if (!vaultName) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const docId = body?.docId;
    const wrappedKey = body?.wrappedKey;
    const wrappedToken = body?.wrappedToken ?? null;
    const title = body?.title ?? null;
    const updatedAt = Number(body?.updatedAt) || Date.now();

    if (
      typeof docId !== "string" ||
      docId.length < 6 ||
      docId.length > 128 ||
      typeof wrappedKey !== "string" ||
      wrappedKey.length < 16 ||
      wrappedKey.length > 1024
    ) {
      return NextResponse.json({ error: "Data item tidak valid" }, { status: 400 });
    }

    // Jangan hidupkan lagi item yang sudah dihapus (tombstone) — ini yang
    // mencegah perangkat lain mengunggah ulang catatan yang sudah dihapus.
    const existing = sqlite
      .prepare(
        "SELECT deleted FROM vault_items WHERE vault_name = ? AND doc_id = ?",
      )
      .get(vaultName, docId) as { deleted: number } | undefined;

    if (existing?.deleted) {
      return NextResponse.json(
        { error: "Catatan sudah dihapus", deleted: true },
        { status: 409 },
      );
    }

    // Dokumen harus masih ada di server. Tanpa ini, sinkronisasi dari
    // perangkat yang masih menyimpan salinan lama bisa membuat item vault
    // untuk dokumen yang sudah dihapus permanen.
    const documentExists = sqlite
      .prepare("SELECT 1 FROM documents WHERE id = ?")
      .get(docId);

    if (!documentExists) {
      // Rapikan item lama yang menunjuk dokumen yang sudah tidak ada.
      sqlite
        .prepare(
          "UPDATE vault_items SET deleted = 1, updated_at = ? WHERE doc_id = ?",
        )
        .run(Date.now(), docId);

      return NextResponse.json(
        { error: "Dokumen tidak ditemukan di server", deleted: true },
        { status: 409 },
      );
    }

    sqlite
      .prepare(
        `INSERT INTO vault_items (vault_name, doc_id, wrapped_key, wrapped_token, title, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(vault_name, doc_id) DO UPDATE SET
           wrapped_key = excluded.wrapped_key,
           wrapped_token = excluded.wrapped_token,
           title = excluded.title,
           updated_at = excluded.updated_at`,
      )
      .run(
        vaultName,
        docId,
        wrappedKey,
        typeof wrappedToken === "string" ? wrappedToken : null,
        typeof title === "string" ? title.slice(0, 200) : null,
        updatedAt,
      );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error put vault item:", error);
    return NextResponse.json({ error: "Gagal menyimpan item" }, { status: 500 });
  }
}

/** DELETE /api/vault?docId=... — tandai item vault sebagai terhapus (tombstone) */
export async function DELETE(request: NextRequest) {
  try {
    const { sqlite } = getDb();
    if (!sqlite) {
      return NextResponse.json({ error: "Tidak didukung" }, { status: 501 });
    }

    const limit = checkRateLimit(getClientIp(request), "vault_sync", RATE_LIMITS.VAULT_SYNC);
    if (!limit.success) {
      return createRateLimitResponse(limit.limit, limit.remaining, limit.reset);
    }

    const vaultName = getVaultName(request);
    if (!vaultName) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    }

    const docId = request.nextUrl.searchParams.get("docId");
    if (!docId) {
      return NextResponse.json({ error: "docId wajib" }, { status: 400 });
    }

    // Simpan tombstone, jangan hapus baris: perangkat lain perlu tahu bahwa
    // catatan ini sudah dihapus supaya tidak mengunggahnya kembali.
    const info = sqlite
      .prepare(
        `INSERT INTO vault_items (vault_name, doc_id, wrapped_key, wrapped_token, title, updated_at, deleted)
         VALUES (?, ?, '', NULL, NULL, ?, 1)
         ON CONFLICT(vault_name, doc_id) DO UPDATE SET
           deleted = 1,
           updated_at = excluded.updated_at`,
      )
      .run(vaultName, docId, Date.now());

    return NextResponse.json({ deleted: info.changes, tombstone: true });
  } catch (error) {
    console.error("Error delete vault item:", error);
    return NextResponse.json({ error: "Gagal menghapus item" }, { status: 500 });
  }
}
