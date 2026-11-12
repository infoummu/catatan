# Catatan

Editor markdown self-hosted dengan **share link terenkripsi end-to-end (zero-knowledge)**.
Tulis di browser, enkripsi terjadi di browser, server hanya menyimpan ciphertext.

- Demo: <https://catatan.elyas.site>
- Kebutuhan: Node.js 20.9+ atau Docker

---

## Asal-usul proyek (penting)

Repo ini **bukan proyek dari nol**. Asalnya adalah **markdowngg** — <https://github.com/xatuke/markdowngg>,
"a zero-knowledge, self-hostable markdown-as-docs-service" — lalu di-*fork* dan dimodifikasi menjadi **Catatan**:

1. **Rebranding** dari `markdown.gg` menjadi **Catatan** (judul header, halaman share, judul tab, konten sambutan).
2. **Perbaikan agar benar-benar bisa jalan**: tabel SQLite dibuat otomatis (`CREATE TABLE IF NOT EXISTS`),
   inisialisasi database dibuat *lazy* (sebelumnya `next build` gagal `SQLITE_BUSY`), dan route share
   dipisah agar bisa memakai link pendek.
3. **Penambahan fitur yang terinspirasi dari [mymarkdown.xyz](https://mymarkdown.xyz)** — bukan port kode,
   hanya ide UX yang diimplementasikan ulang:
   - toolbar format (bold, italic, strikethrough, heading, link, list, quote, code, HR)
   - mode tampilan **Split / Editor only / Preview only**
   - export dokumen (HTML & PDF)
   - drag & drop file `.md` / `.txt`
   - indikator status penyimpanan (Local draft / Saved / Unsaved)
4. **Packaging Docker** (multi-stage, output Next.js standalone) + `docker-compose.yml` untuk self-hosting.

Tidak ada afiliasi dengan markdowngg maupun mymarkdown.xyz. Kredit lengkap ada di bagian
[Lisensi & kredit](#lisensi--kredit).

---

## Fitur

### Bawaan dari markdowngg

- Enkripsi **AES-GCM** sepenuhnya di sisi klien (Web Crypto API)
- **Share link** terpisah: read-only dan editable (dengan write token)
- Dokumen bisa **diperbarui tanpa mengganti link**
- Editor **Monaco** + preview markdown live
- **KaTeX** untuk LaTeX, **GitHub Flavored Markdown** (tabel, task list, strikethrough)
- Tema terang/gelap
- Riwayat dokumen di `localStorage` (maks 50)
- Dukungan SQLite (default) atau PostgreSQL
- Rate limiting per IP

### Tambahan di repo ini

- **Rebranding Catatan** + konten sambutan baru
- **Tabel `documents` dibuat otomatis** saat pertama dipakai, jadi tidak perlu `drizzle-kit push` manual
- **Inisialisasi DB lazy** (`getDb()`), aman terhadap `next build` yang menjalankan banyak worker sekaligus
- **Toolbar format** 12 tombol + shortcut `Ctrl+B` / `Ctrl+I` / `Ctrl+K`
- **Mode tampilan** Split / Editor only / Preview only
- **Export HTML** (file mandiri) dan **PDF** (dialog print browser — hasil vektor, teks tetap bisa diseleksi)
- **Drag & drop** `.md` / `.txt` (maks 1 MB) dengan overlay petunjuk
- **Indikator status**: `Local draft` → `Saved` → `Unsaved`
- **Perbaikan bullet list** di preview (Tailwind Preflight menghapus `list-style`)
- **Perbaikan warna halaman share**: teks mengikuti tema pembaca (sebelumnya selalu palet gelap sehingga
  nyaris tak terbaca pada tema terang)
- **Link share pendek** `/s/<id>#<key>` — 62 karakter (sebelumnya 108 karakter)
- **Favicon monogram "C"** (`src/app/icon.svg`) + `apple-icon.png` untuk iOS
- **Footer** `© <tahun> Catatan` di editor dan halaman share
- **Tombol `+` di header halaman share** dan tautan "Buat catatan baru" di footer,
  supaya pembaca link bisa langsung membuat catatan sendiri
- **Perbaikan overscroll**: latar halaman mengikuti tema (KaTeX sebelumnya membuat area putih muncul saat discroll)
- **Mobile**: daftar dokumen tampil sebagai drawer overlay (sebelumnya menghimpit editor sampai tak terbaca)
- **Ikon**: tombol sidebar memakai chevron (`‹`), tombol hapus riwayat memakai ikon tempat sampah
- **Dockerfile + docker-compose** siap pakai (port 8089)

### Rencana (belum dikerjakan)

- Masa berlaku link (expiry) dan link berpassword
- Beberapa invite link dengan hak berbeda per dokumen
- Daftar dokumen lintas perangkat (sekarang masih per-browser)
- Kolaborasi realtime — ditunda karena bertabrakan dengan model zero-knowledge

---

## Cara kerja

1. Tulis markdown di editor (Monaco), preview ter-render di panel kanan.
2. Klik **Share** → browser membuat kunci acak, mengenkripsi isi, lalu mengirim **ciphertext** ke server.
3. Server menyimpan ciphertext dan hash SHA-256 dari *write token*; isi dokumen tidak bisa dibaca server.
4. **Kunci enkripsi disimpan di URL fragment** (`#...`), yang tidak pernah dikirim ke server.
5. Link **read-only** membuka `/s/<id>#<key>`; link **editable** membawa `&write=<token>`.
6. Penerima mendekripsi di browser masing-masing. Server hanya melihat blob terenkripsi.

Detail teknis:

| Aspek | Nilai |
| --- | --- |
| Algoritma | AES-GCM, IV 12 byte acak per enkripsi |
| Panjang kunci | **128-bit** untuk link baru (22 karakter base64url); 256-bit lama tetap didukung |
| ID dokumen | 10 karakter base62 (baru), 32 hex (lama) |
| Write token | 32 byte acak, disimpan sebagai hash SHA-256 |
| Batas ukuran | 2 MB ciphertext per dokumen |

**Kompatibilitas:** link lama `/view/<32-hex>#<kunci-256-bit>` masih berfungsi penuh.
Route `/view/[id]` dipertahankan di samping `/s/[id]`.

---

## Menjalankan

### Docker (cara yang dipakai di produksi)

```bash
mkdir -p data && chown 1000:1000 data   # container berjalan sebagai user node (uid 1000)
docker compose up -d --build
```

- Aplikasi: <http://localhost:8089> (host 8089 → container 3000)
- Database: `./data/sqlite.db` (bind mount, persist antar restart)

Variabel lingkungan penting:

```env
DATABASE_URL=file:/app/data/sqlite.db   # atau postgresql://user:pass@host:5432/db
PORT=3000
TZ=Asia/Jayapura
```

### Development lokal

```bash
npm ci
cp .env.example .env        # DATABASE_URL=file:./sqlite.db
npm run dev                 # http://localhost:3000
```

> **npm 12+**: install script dependency diblokir secara default sehingga binary native
> `better-sqlite3` tidak ikut terpasang. `package.json` di repo ini sudah memuat `allowScripts`.
> Bila memakai versi npm lain dan muncul `Could not locate the bindings file`:
> `npm rebuild better-sqlite3`.

### Catatan HTTPS (penting untuk fitur share)

`crypto.subtle` hanya tersedia pada **secure context** — HTTPS atau `localhost`.
Jika aplikasi dibuka lewat `http://192.168.x.x:8089`, editor dan preview tetap jalan, tetapi
tombol **Share/Save** akan gagal. Tempatkan di belakang reverse proxy TLS
(Cloudflare Tunnel, nginx, Caddy, dsb).

---

## Route & API

| Route | Keterangan |
| --- | --- |
| `/` | Editor (dokumen aktif disimpan di URL fragment) |
| `/s/<id>#<key>` | Halaman share format baru (pendek) |
| `/view/<id>#<key>` | Halaman share format lama (tetap didukung) |
| `POST /api/documents` | Simpan dokumen baru (ciphertext + hash write token) |
| `GET /api/documents/<id>` | Ambil ciphertext |
| `PUT /api/documents/<id>` | Perbarui ciphertext (butuh write token) |

Rate limit bawaan (in-memory, per IP): 10 pembuatan/jam, 30 update/jam per dokumen, 100 pembacaan/jam.

---

## Struktur singkat

```
src/app/            route Next.js (editor, /s, /view, API)
src/components/     editor Monaco, renderer markdown, sidebar, document-view
src/lib/            crypto (AES-GCM), export HTML/PDF, riwayat dokumen, rate limit
src/db/             drizzle + inisialisasi SQLite (lazy, auto-create tabel)
Dockerfile          multi-stage, output Next.js standalone
docker-compose.yml  service web, port 8089, volume ./data
```

---

## Keamanan & batasan

- Server tidak pernah menerima kunci maupun plaintext; yang tersimpan hanya ciphertext.
- Siapa pun yang memegang **link read-only** dapat membaca; pemegang **link editable** dapat mengubah.
  Tidak ada autentikasi pengguna.
- Kunci 128-bit pada link baru setara AES-128 (belum pernah dipecah). Untuk pilihan lebih konservatif,
  ubah `KEY_LENGTH` di `src/lib/crypto.ts` menjadi `256` — link akan lebih panjang.
- Rate limit disimpan di memori: hilang saat container restart.
- Folder `data/` tidak di-commit (berisi database). Jangan pernah commit `*.db`.

---

## Lisensi & kredit

Dirilis di bawah **MIT License** (lihat [`LICENSE`](./LICENSE)).

- **Source asli:** [markdowngg](https://github.com/xatuke/markdowngg) oleh **xatuke** — proyek
  zero-knowledge markdown editor yang menjadi dasar repo ini.
- **Inspirasi fitur:** [mymarkdown.xyz](https://mymarkdown.xyz) — terutama toolbar format, mode tampilan,
  export dokumen, dan drag & drop.
- **Modifikasi & packaging:** Informatika UMMU Ternate.
