"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  createVault,
  loginVault,
  pushAllLocal,
  pullIntoHistory,
  getVaultSession,
  clearVaultSession,
  VaultSession,
} from "@/lib/vault";

interface VaultDialogProps {
  open: boolean;
  onClose: () => void;
  /** Dipanggil setelah daftar lokal berubah (login / sinkronisasi) */
  onChanged: () => void;
}

type Mode = "login" | "signup";

export function VaultDialog({ open, onClose, onChanged }: VaultDialogProps) {
  const [session, setSession] = useState<VaultSession | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSession(getVaultSession());
      setError(null);
      setInfo(null);
      setPassphrase("");
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (name.trim().length < 3) {
      setError("Nama minimal 3 karakter (huruf kecil, angka, titik, _ atau -)");
      return;
    }
    if (passphrase.length < 8) {
      setError("Passphrase minimal 8 karakter");
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === "signup"
          ? await createVault(name, passphrase)
          : await loginVault(name, passphrase);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      const pulled = await pullIntoHistory(result.session);
      const pushed = await pushAllLocal(result.session);

      setSession(result.session);
      onChanged();

      toast({
        title: mode === "signup" ? "Akun dibuat" : "Berhasil masuk",
        description: `${pulled.added} catatan masuk, ${pushed} catatan tersinkron`,
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const pulled = await pullIntoHistory(session);
      const pushed = await pushAllLocal(session);
      onChanged();
      setInfo(
        `${pulled.added} baru, ${pulled.updated} diperbarui dari akun · ${pushed} terkirim`,
      );
    } catch {
      setError("Sinkronisasi gagal. Periksa koneksi.");
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    clearVaultSession();
    setSession(null);
    setName("");
    setPassphrase("");
    toast({
      title: "Keluar",
      description: "Catatan tetap ada di perangkat ini",
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {session ? "Akun" : "Masuk ke akun"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {session
                ? "Catatan tersinkron antar perangkat"
                : "Opsional — tanpa akun semua fitur tetap jalan"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Tutup"
            title="Tutup"
          >
            ×
          </button>
        </div>

        {session ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              Masuk sebagai{" "}
              <span className="font-medium">{session.name}</span>
            </div>

            <Button
              onClick={handleSync}
              disabled={busy}
              className="w-full"
              size="sm"
            >
              {busy ? "Menyinkronkan…" : "Sinkronkan sekarang"}
            </Button>

            <button
              onClick={handleLogout}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Keluar dari akun ini
            </button>

            {info && (
              <p className="text-xs text-muted-foreground">{info}</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-md border border-border p-1 text-xs">
              <button
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className={`rounded px-2 py-1.5 transition-colors ${
                  mode === "login"
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Masuk
              </button>
              <button
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className={`rounded px-2 py-1.5 transition-colors ${
                  mode === "signup"
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Buat akun
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Nama akun
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="mis. abuisa"
                  autoComplete="username"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="minimal 8 karakter"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button type="submit" disabled={busy} className="w-full" size="sm">
                {busy
                  ? "Memproses…"
                  : mode === "signup"
                    ? "Buat akun"
                    : "Masuk"}
              </Button>
            </form>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Passphrase tidak dikirim ke server dan tidak bisa direset. Kalau
              lupa, catatan yang tersinkron tidak bisa dibuka lagi.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
