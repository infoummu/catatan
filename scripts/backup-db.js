#!/usr/bin/env node
/**
 * Backup harian database SQLite.
 * Memakai API backup() better-sqlite3 sehingga aman dijalankan saat WAL aktif
 * dan container sedang menulis.
 *
 * Jalankan lewat cron, misalnya:
 *   30 2 * * * cd /root/my_project/markdowngg && node scripts/backup-db.js >> /var/log/markdowngg-backup.log 2>&1
 */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "sqlite.db");
const DIR = path.join(ROOT, "backups");
const KEEP = 14;

if (!fs.existsSync(SRC)) {
  console.error(`[backup] database tidak ditemukan: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
const dest = path.join(DIR, `sqlite-${stamp}.db`);

const db = new Database(SRC, { readonly: true });

db.backup(dest)
  .then(() => {
    db.close();
    const size = fs.statSync(dest).size;
    console.log(`[backup] ${new Date().toISOString()} -> ${dest} (${size} bytes)`);

    // Simpan hanya KEEP berkas terbaru
    const files = fs
      .readdirSync(DIR)
      .filter((f) => f.startsWith("sqlite-") && f.endsWith(".db"))
      .sort()
      .reverse();

    for (const old of files.slice(KEEP)) {
      fs.unlinkSync(path.join(DIR, old));
      console.log(`[backup] hapus lama: ${old}`);
    }
  })
  .catch((err) => {
    console.error("[backup] gagal:", err);
    process.exit(1);
  });
