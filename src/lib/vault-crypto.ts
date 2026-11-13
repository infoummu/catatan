/**
 * Kripto untuk akun opsional ("vault").
 *
 * Passphrase tidak pernah dikirim ke server. Yang dikirim hanya:
 * - salt acak (boleh publik)
 * - verifier = SHA-256(kunci turunan passphrase)
 * - kunci dokumen yang sudah dibungkus (AES-GCM) dengan kunci turunan itu
 *
 * Server tetap tidak bisa membaca isi catatan.
 */

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function randomSalt(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export interface DerivedVaultKey {
  key: CryptoKey;
  /** SHA-256 dari kunci mentah, base64url — dipakai server untuk verifikasi login */
  verifier: string;
  /** Kunci mentah (base64url) — disimpan lokal agar sinkronisasi tidak minta passphrase terus */
  rawKey: string;
}

export async function deriveVaultKey(
  passphrase: string,
  saltB64: string,
): Promise<DerivedVaultKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: b64urlToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );

  const raw = new Uint8Array(bits);
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const digest = await crypto.subtle.digest("SHA-256", raw);

  return {
    key,
    verifier: bytesToB64url(new Uint8Array(digest)),
    rawKey: bytesToB64url(raw),
  };
}

/** Impor kembali kunci vault dari sessionStorage/localStorage */
export async function importVaultKey(rawKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    b64urlToBytes(rawKeyB64),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Bungkus rahasia (kunci dokumen / write token) dengan kunci vault */
export async function wrapSecret(
  secret: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return bytesToB64url(combined);
}

/** Buka bungkusan rahasia; null bila passphrase salah / data rusak */
export async function unwrapSecret(
  packed: string,
  key: CryptoKey,
): Promise<string | null> {
  try {
    const all = b64urlToBytes(packed);
    const iv = all.slice(0, IV_BYTES);
    const ct = all.slice(IV_BYTES);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const std = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
