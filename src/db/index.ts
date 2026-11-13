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
  /** Instance SQLite mentah — dipakai tabel vault (akun opsional). Null bila Postgres. */
  sqlite: Database.Database | null;
};

let cached: DbBundle | null = null;

function createDatabase(): DbBundle {
  const databaseUrl = process.env.DATABASE_URL || "file:./sqlite.db";

  if (databaseUrl.startsWith("postgres")) {
    return {
      db: drizzlePg(postgres(databaseUrl)),
      documents: documentsPg,
      sqlite: null,
    };
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
    );

    -- Akun opsional: "vault" menyimpan kunci dokumen yang sudah dibungkus
    -- (key wrapping) dengan kunci turunan passphrase. Isi catatan tetap ciphertext.
    CREATE TABLE IF NOT EXISTS vaults (
      name TEXT PRIMARY KEY NOT NULL,
      salt TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      vault_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_items (
      vault_name TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,
      wrapped_token TEXT,
      title TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (vault_name, doc_id)
    );

    CREATE INDEX IF NOT EXISTS idx_vault_items_name ON vault_items (vault_name);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON vault_sessions (expires_at);
  `);

  return { db: drizzleSqlite(sqlite), documents: documentsLite, sqlite };
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

export type Database_ = ReturnType<typeof getDb>["db"];
