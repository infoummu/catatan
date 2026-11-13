"use client";

import {
  deriveVaultKey,
  importVaultKey,
  randomSalt,
  wrapSecret,
  unwrapSecret,
} from "@/lib/vault-crypto";
import {
  getDocumentHistory,
  saveToHistory,
  DocumentMetadata,
} from "@/lib/document-history";

const SESSION_KEY = "vault_session_v1";

export interface VaultSession {
  name: string;
  token: string;
  /** kunci vault mentah (base64url) — hanya di perangkat ini */
  rawKey: string;
}

export interface VaultItem {
  docId: string;
  wrappedKey: string;
  wrappedToken: string | null;
  title: string | null;
  updatedAt: number;
}

export function getVaultSession(): VaultSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.name || !parsed?.token || !parsed?.rawKey) return null;
    return parsed as VaultSession;
  } catch {
    return null;
  }
}

export function setVaultSession(session: VaultSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearVaultSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function sessionKey(session: VaultSession): Promise<CryptoKey> {
  return importVaultKey(session.rawKey);
}

async function authFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

/** Daftar akun baru. Passphrase hanya dipakai lokal untuk menurunkan kunci. */
export async function createVault(
  name: string,
  passphrase: string,
): Promise<{ session: VaultSession } | { error: string }> {
  const cleanName = name.trim().toLowerCase();
  const salt = randomSalt();
  const { key, verifier, rawKey } = await deriveVaultKey(passphrase, salt);

  const res = await fetch("/api/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: cleanName, salt, verifier }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { error: data.error || "Gagal membuat akun" };
  }

  const login = await fetch(`/api/vaults/${encodeURIComponent(cleanName)}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verifier }),
  });

  if (!login.ok) {
    return { error: "Akun dibuat, tetapi gagal masuk. Coba login." };
  }

  const { token } = await login.json();
  void key;
  const session: VaultSession = { name: cleanName, token, rawKey };
  setVaultSession(session);
  return { session };
}

/** Masuk ke akun yang sudah ada */
export async function loginVault(
  name: string,
  passphrase: string,
): Promise<{ session: VaultSession } | { error: string }> {
  const cleanName = name.trim().toLowerCase();

  const lookup = await fetch(`/api/vaults/${encodeURIComponent(cleanName)}`);
  if (!lookup.ok) {
    return { error: lookup.status === 404 ? "Akun tidak ditemukan" : "Gagal memuat akun" };
  }
  const { salt } = await lookup.json();

  const { verifier, rawKey } = await deriveVaultKey(passphrase, salt);

  const res = await fetch(`/api/vaults/${encodeURIComponent(cleanName)}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verifier }),
  });

  if (!res.ok) {
    return { error: "Nama atau passphrase salah" };
  }

  const { token } = await res.json();
  const session: VaultSession = { name: cleanName, token, rawKey };
  setVaultSession(session);
  return { session };
}

export async function listVaultItems(token: string): Promise<VaultItem[]> {
  const res = await authFetch("/api/vault", token);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function putItem(
  token: string,
  item: VaultItem,
): Promise<boolean> {
  const res = await authFetch("/api/vault", token, {
    method: "PUT",
    body: JSON.stringify(item),
  });
  return res.ok;
}

/** Kirim satu dokumen (kunci + write token dibungkus) ke vault */
export async function pushDocument(
  session: VaultSession,
  meta: DocumentMetadata,
): Promise<boolean> {
  try {
    const key = await sessionKey(session);
    const wrappedKey = await wrapSecret(meta.encryptionKey, key);
    const wrappedToken = meta.writeToken
      ? await wrapSecret(meta.writeToken, key)
      : null;

    return await putItem(session.token, {
      docId: meta.id,
      wrappedKey,
      wrappedToken,
      title: meta.title,
      updatedAt: meta.lastModified,
    });
  } catch (error) {
    console.error("vault push gagal:", error);
    return false;
  }
}

/** Kirim semua dokumen lokal ke vault (dipakai setelah login/daftar) */
export async function pushAllLocal(session: VaultSession): Promise<number> {
  const items = getDocumentHistory();
  let sent = 0;
  for (const meta of items) {
    if (await pushDocument(session, meta)) sent++;
  }
  return sent;
}

/** Tarik daftar dari vault, gabungkan ke riwayat lokal */
export async function pullIntoHistory(
  session: VaultSession,
): Promise<{ added: number; updated: number; failed: number }> {
  const key = await sessionKey(session);
  const items = await listVaultItems(session.token);

  let added = 0;
  let updated = 0;
  let failed = 0;

  for (const item of items) {
    const encryptionKey = await unwrapSecret(item.wrappedKey, key);
    if (!encryptionKey) {
      failed++;
      continue;
    }
    const writeToken = item.wrappedToken
      ? (await unwrapSecret(item.wrappedToken, key)) || ""
      : "";

    const existing = getDocumentHistory().find((d) => d.id === item.docId);

    if (existing && existing.lastModified >= item.updatedAt) {
      continue;
    }

    saveToHistory({
      id: item.docId,
      encryptionKey,
      writeToken,
      title: item.title || existing?.title || "Untitled",
      createdAt: existing?.createdAt ?? item.updatedAt,
      lastModified: item.updatedAt,
    });

    if (existing) updated++;
    else added++;
  }

  return { added, updated, failed };
}

export async function removeFromVault(session: VaultSession, docId: string) {
  try {
    await authFetch(`/api/vault?docId=${encodeURIComponent(docId)}`, session.token, {
      method: "DELETE",
    });
  } catch {
    /* diamkan — penghapusan lokal tetap jalan */
  }
}
