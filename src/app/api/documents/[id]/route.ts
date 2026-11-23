import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
  addRateLimitHeaders,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { verifyWriteToken } from "@/lib/crypto";

/**
 * GET /api/documents/[id]
 * Retrieve a document by ID
 * Rate limit: 100 views per hour per IP
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, documents } = getDb();
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 },
      );
    }

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitResult = checkRateLimit(
      clientIp,
      "get_document",
      RATE_LIMITS.GET_DOCUMENT,
    );

    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.reset,
      );
    }

    // Fetch from database
    const result = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const document = result[0];

    const response = NextResponse.json({
      id: document.id,
      encryptedContent: document.encryptedContent,
      createdAt: document.createdAt,
    });

    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.reset,
    );
  } catch (error) {
    console.error("Error fetching document:", error);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/documents/[id]
 * Update an existing document's encrypted content
 * Rate limit: 30 updates per hour per document ID
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 },
      );
    }

    const { db, documents } = getDb();

    // Rate limiting per document ID (prevents spam updates to same doc)
    const rateLimitResult = checkRateLimit(
      id,
      "update_document",
      RATE_LIMITS.UPDATE_DOCUMENT,
    );

    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.reset,
      );
    }

    const body = await request.json();
    const { encryptedContent, writeToken } = body;

    if (!encryptedContent || typeof encryptedContent !== "string") {
      return NextResponse.json(
        { error: "Invalid encrypted content" },
        { status: 400 },
      );
    }

    if (!writeToken || typeof writeToken !== "string") {
      return NextResponse.json(
        { error: "Write token required" },
        { status: 401 },
      );
    }

    // Limit encrypted content size to 2MB
    if (encryptedContent.length > 1024 * 1024 * 2) {
      return NextResponse.json(
        { error: "Document too large (max 2MB)" },
        { status: 413 },
      );
    }

    // Check if document exists
    const existing = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Check if document has write token (old documents don't)
    if (!existing[0].writeTokenHash) {
      return NextResponse.json(
        { error: "This document was created before write protection was added and cannot be edited" },
        { status: 403 },
      );
    }

    // Verify write token
    const isValidToken = await verifyWriteToken(
      writeToken,
      existing[0].writeTokenHash
    );

    if (!isValidToken) {
      return NextResponse.json(
        { error: "Invalid write token" },
        { status: 403 },
      );
    }

    // Update the document
    await db
      .update(documents)
      .set({ encryptedContent })
      .where(eq(documents.id, id));

    const response = NextResponse.json({ id, updated: true });
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.reset,
    );
  } catch (error) {
    console.error("Error updating document:", error);
    return NextResponse.json(
      { error: "Failed to update document" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Hapus permanen dokumen dari server.
 *
 * Otorisasi:
 * - write token yang cocok dengan hash dokumen.
 *
 * Sesi vault sengaja TIDAK dipakai sebagai bukti kepemilikan: siapa pun bisa
 * membuat item vault untuk docId yang dikenalnya, jadi itu tidak boleh memberi
 * hak menghapus dokumen orang lain.
 *
 * Semua item vault yang menunjuk dokumen ini ditandai `deleted = 1` (tombstone)
 * agar sinkronisasi di perangkat lain tidak mengunggah ulang dokumen yang sudah
 * dihapus. Dokumen dengan tombstone tidak bisa dihidupkan lagi lewat PUT.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 },
      );
    }

    const rateLimitResult = checkRateLimit(
      getClientIp(request),
      `delete_document:${id}`,
      RATE_LIMITS.DELETE_DOCUMENT,
    );

    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.reset,
      );
    }

    const { db, documents, sqlite } = getDb();

    const existing = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    // Idempotent: kalau dokumen sudah tidak ada, pastikan tidak ada item vault
    // yang masih bisa menariknya kembali.
    if (existing.length === 0) {
      if (sqlite) {
        sqlite
          .prepare(
            "UPDATE vault_items SET deleted = 1, updated_at = ? WHERE doc_id = ? AND deleted = 0",
          )
          .run(Date.now(), id);
      }
      return NextResponse.json({ id, deleted: false, alreadyDeleted: true });
    }

    const body = await request.json().catch(() => null);
    const writeToken =
      typeof body?.writeToken === "string" ? body.writeToken : null;

    let authorized = false;

    if (existing[0].writeTokenHash && writeToken) {
      authorized = await verifyWriteToken(
        writeToken,
        existing[0].writeTokenHash,
      );
    }

    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Tidak berhak menghapus dokumen ini. Hapus dari perangkat yang menyimpan write token catatan ini.",
        },
        { status: 403 },
      );
    }

    await db.delete(documents).where(eq(documents.id, id));

    let tombstoned = 0;
    if (sqlite) {
      const info = sqlite
        .prepare(
          "UPDATE vault_items SET deleted = 1, updated_at = ? WHERE doc_id = ? AND deleted = 0",
        )
        .run(Date.now(), id);
      tombstoned = info.changes;
    }

    const response = NextResponse.json({
      id,
      deleted: true,
      vaultItems: tombstoned,
    });

    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.reset,
    );
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
