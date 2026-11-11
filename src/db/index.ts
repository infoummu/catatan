import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import postgres from "postgres";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { documentsPg, documentsLite } from "./schema";

type DbBundle = {
  db: any;
  documents: typeof documentsPg | typeof documentsLite;
};

let cached: DbBundle | null = null;

function createDatabase(): DbBundle {
  const databaseUrl = process.env.DATABASE_URL || "file:./sqlite.db";

  if (databaseUrl.startsWith("postgres")) {
    return { db: drizzlePg(postgres(databaseUrl)), documents: documentsPg };
  }

  const dbPath = databaseUrl.replace("file:", "");

  // Pastikan direktori database ada (mis. /app/data di Docker)
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath, { timeout: 10000 });
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("journal_mode = WAL");

  // Buat tabel bila belum ada — setara `drizzle-kit push` untuk schema di atas
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      encrypted_content TEXT NOT NULL,
      write_token_hash TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  return { db: drizzleSqlite(sqlite), documents: documentsLite };
}

/**
 * Inisialisasi database lazily (saat request pertama), bukan saat modul di-import.
 * `next build` menjalankan beberapa worker paralel yang meng-import route API;
 * membuka file SQLite di situ memicu SQLITE_BUSY dan menggagalkan build.
 */
export function getDb(): DbBundle {
  if (!cached) {
    cached = createDatabase();
  }
  return cached;
}

export type Database = ReturnType<typeof getDb>["db"];
