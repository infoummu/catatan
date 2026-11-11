import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { generateId } from "@/lib/crypto";
import { eq } from "drizzle-orm";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
  addRateLimitHeaders,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/documents
 * Create a new document with encrypted content
 * Rate limit: 10 documents per hour per IP
 */
export async function POST(request: NextRequest) {
  try {
    const { db, documents } = getDb();

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitResult = checkRateLimit(
      clientIp,
      "create_document",
      RATE_LIMITS.CREATE_DOCUMENT,
    );

    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.reset,
      );
    }

    const body = await request.json();
    const { encryptedContent, writeTokenHash } = body;

    if (!encryptedContent || typeof encryptedContent !== "string") {
      return NextResponse.json(
        { error: "Invalid encrypted content" },
        { status: 400 },
      );
    }

    if (!writeTokenHash || typeof writeTokenHash !== "string") {
      return NextResponse.json(
        { error: "Invalid write token hash" },
        { status: 400 },
      );
    }

    // Limit encrypted content size to 2MB
    if (encryptedContent.length > 1024 * 1024 * 2) {
      return NextResponse.json(
        { error: "Document too large (max 2MB)" },
        { status: 413 },
      );
    }

    // Generate unique ID (10 karakter) — ulangi bila bentrok
    let id = generateId();
    let created = false;

    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        await db.insert(documents).values({
          id,
          encryptedContent,
          writeTokenHash,
          createdAt: new Date(),
        });
        created = true;
      } catch (error: any) {
        const message = String(error?.message || "");
        if (message.includes("UNIQUE") || message.includes("constraint")) {
          id = generateId();
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      return NextResponse.json(
        { error: "Failed to allocate document id" },
        { status: 500 },
      );
    }

    const response = NextResponse.json({ id }, { status: 201 });
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.reset,
    );
  } catch (error) {
    console.error("Error creating document:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 },
    );
  }
}
