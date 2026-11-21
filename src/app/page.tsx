"use client";

import { useState, useEffect, useRef } from "react";
import type { DragEvent } from "react";
import { Editor } from "@/components/editor";
import type { EditorHandle, FormatKind } from "@/components/editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Footer } from "@/components/footer";
import { VaultDialog } from "@/components/vault-dialog";
import { getVaultSession, pushDocument } from "@/lib/vault";
import { DocumentSidebar } from "@/components/document-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useTheme } from "@/contexts/theme-context";
import {
  Share2,
  FileText,
  Save,
  Copy,
  FilePlus,
  Menu,
  ChevronLeft,
  UserRound,
  MoreVertical,
  Sun,
  Moon,
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Link2,
  List,
  ListOrdered,
  Quote,
  Code2,
  Minus,
  Columns2,
  PenLine,
  Eye,
  Download,
  ZoomIn,
  ZoomOut,
  Eraser,
} from "lucide-react";
import {
  downloadHtmlFile,
  printPdf,
  downloadMarkdownFile,
  joinMarkdownDocuments,
  exportAllFileName,
} from "@/lib/export";
import {
  generateKey,
  exportKey,
  encrypt,
  importKey,
  decrypt,
  generateWriteToken,
  hashWriteToken,
} from "@/lib/crypto";
import {
  getDocumentHistory,
  getDocumentFromHistory,
  saveToHistory,
  removeFromHistory,
  extractTitle,
  DocumentMetadata,
} from "@/lib/document-history";

const DEFAULT_CONTENT = `# Selamat datang di Catatan

Catatan adalah editor markdown untuk menulis dan membagikan catatan secara online.
Isi catatan **dienkripsi di browser** sebelum dikirim, jadi server tidak bisa membacanya.

## Lihat hasilnya di panel kanan

Tulis di panel kiri, pratinjaunya langsung tampil di sebelahnya.
Di ponsel, gunakan tab **Editor / Preview** untuk bergantian.

## Cara pakai

1. Tulis catatan di panel kiri. Begitu mulai mengetik, tombol **Share** otomatis berganti jadi **Save**.
2. Klik **Save** untuk menyimpan dan membuat link — link tetap sama untuk setiap perubahan berikutnya.
3. Bagikan lewat menu **Share** di header: pilihan **read-only** (hanya membaca) atau **editable** (penerima bisa mengubah).
4. Tombol **Clear** (ikon penghapus) mengosongkan editor untuk mulai catatan baru; pada catatan tersimpan muncul konfirmasi dulu.
5. Toolbar di atas mempercepat format: tebal, miring, judul, daftar, kutipan, blok kode.
6. Tombol **Export** menyimpan catatan sebagai HTML atau PDF; pilih **Semua catatan (.md)** untuk mengunduh seluruh riwayat sebagai satu file markdown.

## Contoh format

**Tebal**, *miring*, ~~coret~~, dan \`kode inline\`.

- Daftar berbutir
  - dengan sub-butir
- Bisa juga berisi [tautan](https://example.com)

1. Daftar bernomor
2. Urutannya jelas

> Kutipan dipakai untuk menegaskan satu hal penting.

| Fitur | Status |
| --- | --- |
| Enkripsi end-to-end | ✓ |
| Link read-only & editable | ✓ |
| Export HTML, PDF & Markdown | ✓ |
| Zoom teks editor | ✓ |
| Rumus LaTeX | ✓ |

## Rumus (LaTeX)

Inline: $E = mc^2$

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## Blok kode

\`\`\`javascript
function halo(nama) {
  return \`Halo, \${nama}!\`;
}
\`\`\`

---

## Yang perlu diketahui

- Kunci enkripsi disimpan di bagian \`#\` pada URL dan **tidak pernah dikirim ke server**.
- Siapa pun yang memegang link read-only bisa membaca; pemegang link editable bisa mengubah isi.
- Riwayat catatan tersimpan di browser ini (maksimal 50 catatan).

Hapus isi halaman ini, lalu mulai menulis. Selamat mencatat!
`;

const TOOLBAR: { kind: FormatKind; Icon: typeof Bold; title: string }[] = [
  { kind: "bold", Icon: Bold, title: "Bold (Ctrl+B)" },
  { kind: "italic", Icon: Italic, title: "Italic (Ctrl+I)" },
  { kind: "strike", Icon: Strikethrough, title: "Strikethrough" },
  { kind: "h1", Icon: Heading1, title: "Heading 1" },
  { kind: "h2", Icon: Heading2, title: "Heading 2" },
  { kind: "link", Icon: Link2, title: "Link (Ctrl+K)" },
  { kind: "ul", Icon: List, title: "Bullet list" },
  { kind: "ol", Icon: ListOrdered, title: "Numbered list" },
  { kind: "quote", Icon: Quote, title: "Blockquote" },
  { kind: "code", Icon: Code2, title: "Inline code" },
  { kind: "codeblock", Icon: FileText, title: "Code block" },
  { kind: "hr", Icon: Minus, title: "Horizontal rule" },
];

// Zoom teks editor
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 14;
const FONT_SIZE_STORAGE_KEY = "editor_font_size";

export default function Home() {
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [documentHistory, setDocumentHistory] = useState<DocumentMetadata[]>(
    [],
  );
  const [editorWidth, setEditorWidth] = useState(50); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("editor");
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [viewMode, setViewMode] = useState<"split" | "editor" | "preview">(
    "split",
  );
  const [isDragging, setIsDragging] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [showVault, setShowVault] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearUndoRef = useRef<string | null>(null);
  const fontSizeTouched = useRef(false);
  const editorApi = useRef<EditorHandle | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const { toast, dismiss } = useToast();
  const { theme, toggleTheme } = useTheme();

  // Load document history on mount
  useEffect(() => {
    setDocumentHistory(getDocumentHistory());
    const session = getVaultSession();
    setVaultName(session?.name ?? null);
    // Tarik daftar dari akun (kalau ada sesi) agar perangkat baru langsung terisi
    if (session) {
      import("@/lib/vault").then(({ pullIntoHistory }) =>
        pullIntoHistory(session)
          .then(() => setDocumentHistory(getDocumentHistory()))
          .catch(() => undefined),
      );
    }
  }, []);

  // Zoom teks editor: ukuran tersimpan di browser, dibaca setelah hidrasi
  useEffect(() => {
    const stored = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
    if (stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE) {
      setFontSize(stored);
    }
  }, []);

  useEffect(() => {
    if (!fontSizeTouched.current) {
      fontSizeTouched.current = true;
      return;
    }
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  function zoomEditor(delta: number) {
    setFontSize((size) =>
      Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size + delta)),
    );
  }

  function handleZoomCommand(cmd: "in" | "out" | "reset") {
    if (cmd === "reset") {
      setFontSize(DEFAULT_FONT_SIZE);
      return;
    }
    zoomEditor(cmd === "in" ? 1 : -1);
  }

  // Load document from URL hash on mount and hash changes
  useEffect(() => {
    async function loadFromUrl() {
      const hash = window.location.hash.substring(1);
      if (!hash) {
        // No hash = new document
        setDocumentId(null);
        setEncryptionKey(null);
        setWriteToken(null);
        setContent(DEFAULT_CONTENT);
        setSavedSnapshot(null);
        return;
      }

      // Parse hash format: [id]#key&write=token or [id]#key
      const parts = hash.split("#");
      if (parts.length < 2) {
        console.error("Invalid URL format");
        return;
      }

      const id = parts[0];
      const keyAndToken = parts[1];
      const hashParams = new URLSearchParams(keyAndToken);
      const keyString = hashParams.get("write")
        ? keyAndToken.split("&")[0]
        : keyAndToken;
      const tokenString = hashParams.get("write");

      try {
        setIsLoading(true);
        setDocumentId(id);
        setEncryptionKey(keyString);
        setWriteToken(tokenString);

        // Fetch encrypted document
        const response = await fetch(`/api/documents/${id}`);
        if (!response.ok) {
          throw new Error("Document not found");
        }

        const { encryptedContent } = await response.json();

        // Decrypt content
        const key = await importKey(keyString);
        const decryptedContent = await decrypt(encryptedContent, key);

        setContent(decryptedContent);
        setSavedSnapshot(decryptedContent);
        const existing = getDocumentFromHistory(id);
        saveToHistory({
          id,
          encryptionKey: keyString,
          writeToken: tokenString || "",
          title: extractTitle(decryptedContent),
          createdAt: existing?.createdAt ?? Date.now(),
          lastModified: Date.now(),
        });
        setDocumentHistory(getDocumentHistory());
      } catch (error) {
        console.error("Error loading document:", error);
        toast({
          title: "Error",
          description: "Failed to load document",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadFromUrl();

    // Listen for hash changes
    const handleHashChange = () => loadFromUrl();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Keyboard shortcut for save (Ctrl+S or Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isSaving || isLoading) return;
        if (documentId && !writeToken) return; // read-only
        if (documentId && encryptionKey && writeToken) {
          handleSave();
        } else if (
          !documentId &&
          content.trim().length > 0 &&
          content !== DEFAULT_CONTENT
        ) {
          handleCreateDocument("save");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    documentId,
    encryptionKey,
    writeToken,
    isSaving,
    isLoading,
    content,
  ]);

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const container = document.querySelector(".editor-preview-container");
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedWidth = Math.min(Math.max(newWidth, 20), 80);
      setEditorWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Get read-only shareable URL (view only, no write token)
  const getReadOnlyUrl = () => {
    if (!documentId || !encryptionKey) return null;
    return `${window.location.origin}/s/${documentId}#${encryptionKey}`;
  };

  // Get editable shareable URL (with write token)
  const getEditableUrl = () => {
    if (!documentId || !encryptionKey || !writeToken) return null;
    return `${window.location.origin}/#${documentId}#${encryptionKey}&write=${writeToken}`;
  };

  // Copy read-only URL to clipboard
  async function copyReadOnlyUrl() {
    const url = getReadOnlyUrl();
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Read-only link copied",
        description: "Recipients can view but not edit",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy link",
        variant: "destructive",
      });
    }
  }

  // Copy editable URL to clipboard
  async function copyEditableUrl() {
    const url = getEditableUrl();
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Editable link copied",
        description: "Recipients can view and edit",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy link",
        variant: "destructive",
      });
    }
  }

  // Save updates to existing document
  async function handleSave() {
    if (!documentId || !encryptionKey) return;

    try {
      setIsSaving(true);

      // Import the key and encrypt content
      const key = await importKey(encryptionKey);
      const encryptedContent = await encrypt(content, key);

      // Update on server
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedContent,
          writeToken: writeToken || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update document");
      }

      // Update in history (preserve original createdAt)
      const existing = getDocumentFromHistory(documentId);
      saveToHistory({
        id: documentId,
        encryptionKey: encryptionKey,
        writeToken: writeToken || "",
        title: extractTitle(content),
        createdAt: existing?.createdAt ?? Date.now(),
        lastModified: Date.now(),
      });

      setDocumentHistory(getDocumentHistory());
      setSavedSnapshot(content);

      // Sinkron ke akun (kalau login) — kegagalan tidak mengganggu penyimpanan
      const session = getVaultSession();
      if (session) {
        const meta = getDocumentFromHistory(documentId);
        if (meta) void pushDocument(session, meta);
      }

      toast({
        title: "Saved",
        description: "Document updated successfully",
      });
    } catch (error) {
      console.error("Error saving:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save document",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // Tombol utama: dokumen lama → PUT, draft baru → buat dokumen dulu
  function handlePrimarySave() {
    if (documentId) return handleSave();
    return handleCreateDocument("save");
  }

  // Buat dokumen baru di server (dipakai tombol Share dan Save pertama kali)
  async function handleCreateDocument(mode: "share" | "save" = "share") {
    try {
      setIsSharing(true);

      // Generate encryption key
      const key = await generateKey();
      const keyString = await exportKey(key);

      // Generate write token
      const token = generateWriteToken();
      const tokenHash = await hashWriteToken(token);

      // Encrypt content
      const encryptedContent = await encrypt(content, key);

      // Save to server
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedContent,
          writeTokenHash: tokenHash,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save document");
      }

      const { id } = await response.json();

      // Save to history
      const now = Date.now();
      saveToHistory({
        id,
        encryptionKey: keyString,
        writeToken: token,
        title: extractTitle(content),
        createdAt: now,
        lastModified: now,
      });

      setDocumentHistory(getDocumentHistory());
      setSavedSnapshot(content);

      // Kalau sedang login, catatan baru langsung ikut tersinkron
      const session = getVaultSession();
      if (session) {
        const meta = getDocumentFromHistory(id);
        if (meta) void pushDocument(session, meta);
      }

      // Navigate to the new document URL (with write token)
      window.location.hash = `${id}#${keyString}&write=${token}`;


      toast(
        mode === "save"
          ? {
              title: "Catatan disimpan",
              description:
                "Link sudah dibuat — bagikan lewat tombol Share di bagian atas.",
            }
          : {
              title: "Document created",
              description: "You can now share this document with others",
            },
      );
    } catch (error) {
      console.error("Error sharing:", error);
      toast({
        title: "Error",
        description: "Failed to create shareable link",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  }

  // Start a new document
  function handleNew() {
    if (window.location.hash) {
      // Navigate to home (clear hash) — loadFromUrl akan mereset isi editor
      window.location.hash = "";
    } else {
      setDocumentId(null);
      setEncryptionKey(null);
      setWriteToken(null);
      setContent(DEFAULT_CONTENT);
      setSavedSnapshot(null);
    }
    setConfirmClear(false);

    toast({
      title: "New document",
      description: "Started a new document",
    });
  }

  // Isi editor berubah: draft tanpa link dianggap "mulai menulis"
  function handleContentChange(value: string) {
    setContent(value);
    // Sudah mengetik lagi setelah Clear → tawaran "Urungkan" tidak relevan
    if (clearUndoRef.current !== null && value.trim().length > 0) {
      clearUndoRef.current = null;
      dismiss();
    }
  }

  // Tombol Clear: draft dikosongkan langsung, catatan tersimpan minta konfirmasi
  function requestClear() {
    if (!canClear) return;
    if (documentId) {
      setConfirmClear(true);
      return;
    }
    applyClear();
  }

  function applyClear() {
    clearUndoRef.current = content;
    setContent("");
    editorApi.current?.focus();
    toast({
      title: "Editor dikosongkan",
      description: documentId
        ? "Klik Save untuk menerapkan. Versi tersimpan masih aman di server."
        : "Editor siap untuk catatan baru.",
      action: (
        <ToastAction altText="Urungkan" onClick={undoClear}>
          Urungkan
        </ToastAction>
      ),
    });
  }

  function undoClear() {
    const previous = clearUndoRef.current;
    if (previous === null) return;
    clearUndoRef.current = null;
    setContent(previous);
    editorApi.current?.focus();
    toast({ title: "Dipulihkan", description: "Isi editor kembali seperti semula" });
  }

  // Escape menutup dialog konfirmasi Clear
  useEffect(() => {
    if (!confirmClear) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmClear(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClear]);

  // Load a document from history
  function loadDocument(doc: DocumentMetadata) {
    // Navigate to the document URL
    const hash = doc.writeToken
      ? `${doc.id}#${doc.encryptionKey}&write=${doc.writeToken}`
      : `${doc.id}#${doc.encryptionKey}`;

    window.location.hash = hash;
    setSidebarOpen(false);
  }

  // Delete a document from history
  function deleteDocument(id: string) {
    removeFromHistory(id);
    setDocumentHistory(getDocumentHistory());

    // If it's the current document, clear it
    if (documentId === id) {
      handleNew();
    }

    toast({
      title: "Document removed",
      description: "Removed from your history",
    });
  }

  const isReadOnly = documentId !== null && !writeToken;
  const isDirty = documentId !== null && savedSnapshot !== content;
  // Setelah ketikan pertama pada draft, tombol utama jadi Save
  const isDraftStarted =
    documentId === null &&
    content !== DEFAULT_CONTENT &&
    content.trim().length > 0;
  const isSaveMode = documentId !== null || isDraftStarted;
  const canClear = content.trim().length > 0 && !isReadOnly;
  const docTitle = extractTitle(content);

  function exportBodyHtml(): string {
    return exportRef.current?.innerHTML?.trim() || "<p></p>";
  }

  function handleExportHtml() {
    try {
      downloadHtmlFile(docTitle, exportBodyHtml());
      toast({
        title: "Exported",
        description: "HTML file downloaded",
      });
    } catch (error) {
      console.error("Export HTML gagal:", error);
      toast({
        title: "Export failed",
        description: "Try again",
        variant: "destructive",
      });
    }
  }

  function handleExportPdf() {
    const ok = printPdf(docTitle, exportBodyHtml());
    if (!ok) {
      toast({
        title: "Popup blocked",
        description: "Allow popups to create PDF",
        variant: "destructive",
      });
    }
  }

  /**
   * Ekspor semua catatan di riwayat menjadi satu file .md.
   * Isi diambil ulang dari server lalu didekripsi di browser (server tetap
   * tidak pernah menerima kunci), urut dari catatan paling lama.
   */
  async function handleExportAllMarkdown() {
    const docs = [...getDocumentHistory()].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    if (docs.length === 0) {
      toast({
        title: "Belum ada catatan tersimpan",
        description: "Simpan catatan lewat Share agar masuk riwayat",
        variant: "destructive",
      });
      return;
    }

    setIsExportingAll(true);
    let failed = 0;
    const contents: string[] = [];

    try {
      for (const doc of docs) {
        try {
          const response = await fetch(`/api/documents/${doc.id}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const { encryptedContent } = await response.json();
          const key = await importKey(doc.encryptionKey);
          contents.push(await decrypt(encryptedContent, key));
        } catch (error) {
          failed += 1;
          console.error(`Gagal mengekspor catatan ${doc.id}:`, error);
        }
      }

      if (contents.length === 0) {
        throw new Error("Tidak ada catatan yang bisa diunduh");
      }

      downloadMarkdownFile(exportAllFileName(), joinMarkdownDocuments(contents));

      toast({
        title: "Exported",
        description: `${contents.length} catatan digabung jadi satu file .md${
          failed ? `, ${failed} dilewati` : ""
        }`,
      });
    } catch (error) {
      console.error("Export semua gagal:", error);
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setIsExportingAll(false);
    }
  }

  async function handleDropFile(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      toast({
        title: "Unsupported file",
        description: "Use .md or .txt",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Max 1 MB",
        variant: "destructive",
      });
      return;
    }

    if (documentId) {
      toast({
        title: "Document already shared",
        description: "Click New before opening another file",
      });
      return;
    }

    const text = await file.text();
    setContent(text);
    setSavedSnapshot(null);
    toast({ title: "File loaded", description: file.name });
  }

  return (
    <div
      className="flex flex-col h-screen bg-background relative overflow-x-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDropFile}
    >
      {/* Header */}
      <header className="border-b border-border px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 shrink-0"
            title={
              sidebarOpen
                ? "Sembunyikan daftar catatan"
                : "Tampilkan daftar catatan"
            }
            aria-label={
              sidebarOpen
                ? "Sembunyikan daftar catatan"
                : "Tampilkan daftar catatan"
            }
          >
            {sidebarOpen ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <Menu className="w-4 h-4" />
            )}
          </Button>

          <FileText className="w-5 h-5 shrink-0" />
          <h1 className="text-base font-semibold truncate">Catatan</h1>

          <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground ml-1 shrink-0">
            {!documentId ? (
              isDraftStarted ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Belum disimpan
                </>
              ) : (
                "Local draft"
              )
            ) : isSaving ? (
              "Saving…"
            ) : isDirty ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Unsaved
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Saved
              </>
            )}
          </span>

          {documentId && (
            <div className="relative ml-1 sm:ml-4 shrink-0">
              <Button
                onClick={() => setShowShareMenu(!showShareMenu)}
                size="sm"
                variant="ghost"
                className="h-7 px-2 gap-1.5"
                title="Share options"
              >
                <Share2 className="w-3 h-3" />
                <span className="text-xs hidden sm:inline">Share</span>
              </Button>

              {showShareMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowShareMenu(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 w-64 bg-popover border border-border rounded-md shadow-lg z-20 py-1">
                    <button
                      onClick={() => {
                        copyReadOnlyUrl();
                        setShowShareMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-start gap-3"
                    >
                      <Copy className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">Read-only link</div>
                        <div className="text-xs text-muted-foreground">
                          Recipients can view but not edit
                        </div>
                      </div>
                    </button>

                    {writeToken && (
                      <button
                        onClick={() => {
                          copyEditableUrl();
                          setShowShareMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-start gap-3"
                      >
                        <Copy className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium">Editable link</div>
                          <div className="text-xs text-muted-foreground">
                            Recipients can view and edit
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="relative hidden md:block">
            <Button
              onClick={() => setShowExportMenu(!showExportMenu)}
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2"
              title="Export dokumen"
            >
              <Download className="w-4 h-4" />
              <span className="text-xs hidden sm:inline">Export</span>
            </Button>

            {showExportMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowExportMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-md shadow-lg z-20 py-1">
                  <button
                    onClick={() => {
                      handleExportHtml();
                      setShowExportMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    HTML (.html)
                  </button>
                  <button
                    onClick={() => {
                      handleExportPdf();
                      setShowExportMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    PDF (print)
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={() => {
                      handleExportAllMarkdown();
                      setShowExportMenu(false);
                    }}
                    disabled={isExportingAll}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                    title="Gabungkan semua catatan di riwayat jadi satu file .md"
                  >
                    {isExportingAll
                      ? "Menyiapkan…"
                      : "Semua catatan (.md)"}
                  </button>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={() => setShowVault(true)}
            size="sm"
            variant="ghost"
            className="hidden md:inline-flex h-8 gap-1.5 px-2"
            title={vaultName ? `Akun: ${vaultName}` : "Masuk / buat akun"}
            aria-label={vaultName ? `Akun: ${vaultName}` : "Masuk atau buat akun"}
          >
            <UserRound className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">
              {vaultName ?? "Akun"}
            </span>
            {vaultName && (
              <span className="hidden sm:inline h-1.5 w-1.5 rounded-full bg-green-500" />
            )}
          </Button>

          <Button
            onClick={toggleTheme}
            size="sm"
            variant="ghost"
            className="hidden md:inline-flex h-8 w-8 p-0"
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </Button>

          <Button
            onClick={requestClear}
            disabled={!canClear}
            size="sm"
            variant="ghost"
            className="hidden md:inline-flex h-8 w-8 p-0"
            title={
              canClear
                ? "Kosongkan editor — mulai catatan baru"
                : "Editor sudah kosong"
            }
            aria-label="Kosongkan editor"
          >
            <Eraser className="w-4 h-4" />
          </Button>

          {documentId && (
            <Button
              onClick={handleNew}
              size="sm"
              variant="outline"
              className="hidden md:inline-flex gap-2"
              title="New document"
            >
              <FilePlus className="w-4 h-4" />
              <span className="hidden sm:inline">New</span>
            </Button>
          )}

          {documentId && !writeToken ? (
            <div className="px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-md">
              Read Only
            </div>
          ) : isSaveMode ? (
            <Button
              onClick={handlePrimarySave}
              disabled={isSaving || isSharing || isLoading}
              size="sm"
              className="gap-2"
              title={
                documentId
                  ? "Simpan perubahan ke dokumen ini"
                  : "Simpan catatan dan buat link"
              }
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isSaving || isSharing ? "Saving..." : "Save"}
              </span>
            </Button>
          ) : (
            <Button
              onClick={() => handleCreateDocument("share")}
              disabled={isSharing || isLoading}
              size="sm"
              className="gap-2"
              title={isSharing ? "Creating link..." : "Share document"}
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isSharing ? "Creating link..." : "Share"}
              </span>
            </Button>
          )}

          {/* Menu ringkas untuk layar kecil */}
          <div className="relative md:hidden">
            <Button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Menu lainnya"
              aria-label="Menu lainnya"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>

            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-md shadow-lg z-20 py-1 text-sm">
                  <button
                    onClick={() => {
                      requestClear();
                      setShowMoreMenu(false);
                    }}
                    disabled={!canClear}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 disabled:opacity-50"
                  >
                    <Eraser className="w-4 h-4" />
                    Kosongkan editor
                  </button>

                  {documentId && (
                    <button
                      onClick={() => {
                        handleNew();
                        setShowMoreMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                    >
                      <FilePlus className="w-4 h-4" />
                      Catatan baru
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setShowVault(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                  >
                    <UserRound className="w-4 h-4" />
                    {vaultName ? `Akun: ${vaultName}` : "Masuk / buat akun"}
                  </button>

                  <button
                    onClick={() => {
                      setSidebarOpen(!sidebarOpen);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                  >
                    <Menu className="w-4 h-4" />
                    Daftar catatan
                  </button>

                  <button
                    onClick={() => {
                      toggleTheme();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                  >
                    {theme === "dark" ? (
                      <Sun className="w-4 h-4" />
                    ) : (
                      <Moon className="w-4 h-4" />
                    )}
                    {theme === "dark" ? "Mode terang" : "Mode gelap"}
                  </button>

                  <div className="my-1 border-t border-border" />

                  <button
                    onClick={() => {
                      handleExportHtml();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Export HTML
                  </button>
                  <button
                    onClick={() => {
                      handleExportPdf();
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Export PDF
                  </button>
                  <button
                    onClick={() => {
                      handleExportAllMarkdown();
                      setShowMoreMenu(false);
                    }}
                    disabled={isExportingAll}
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    {isExportingAll ? "Menyiapkan…" : "Export semua (.md)"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Toolbar format + zoom + mode tampilan */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
        {/* Tombol format: area sendiri, bisa digeser bila layar sempit */}
        <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto">
          {TOOLBAR.map(({ kind, Icon, title }) => (
            <button
              key={kind}
              title={title}
              disabled={isReadOnly}
              onClick={() => editorApi.current?.format(kind)}
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex-shrink-0"
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Zoom teks editor */}
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => zoomEditor(-1)}
              disabled={fontSize <= MIN_FONT_SIZE}
              title="Perkecil teks editor (Ctrl+-)"
              aria-label="Perkecil teks editor"
              className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
              title={`Ukuran teks ${fontSize}px — klik untuk kembali ke ${DEFAULT_FONT_SIZE}px (Ctrl+0)`}
              aria-label={`Ukuran teks editor ${fontSize} piksel, klik untuk mengatur ulang`}
              className="h-8 px-1.5 rounded text-[11px] tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {fontSize}px
            </button>
            <button
              onClick={() => zoomEditor(1)}
              disabled={fontSize >= MAX_FONT_SIZE}
              title="Perbesar teks editor (Ctrl+=)"
              aria-label="Perbesar teks editor"
              className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => setViewMode("split")}
              title="Split view"
              className={`h-6 w-7 flex items-center justify-center rounded ${
                viewMode === "split"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("editor")}
              title="Editor only"
              className={`h-6 w-7 flex items-center justify-center rounded ${
                viewMode === "editor"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <PenLine className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("preview")}
              title="Preview only"
              className={`h-6 w-7 flex items-center justify-center rounded ${
                viewMode === "preview"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Tabs (visible on small screens) */}
      <div className="md:hidden flex border-b border-border">
        <button
          onClick={() => setActiveTab("editor")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "editor"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Editor
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "preview"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar: drawer overlay di mobile, kolom tetap di desktop */}
        {sidebarOpen && (
          <>
            <div
              onClick={() => setSidebarOpen(false)}
              className="md:hidden fixed inset-0 z-20 bg-black/50"
              aria-hidden="true"
            />
            <div className="absolute md:relative inset-y-0 left-0 z-30 w-64 border-r border-border bg-card overflow-hidden shadow-xl md:shadow-none">
              <DocumentSidebar
                documents={documentHistory}
                currentDocumentId={documentId}
                onSelectDocument={loadDocument}
                onDeleteDocument={deleteDocument}
              />
            </div>
            <Separator orientation="vertical" className="hidden md:block" />
          </>
        )}

        {/* Mobile View: Single Panel with Tabs */}
        <div className="flex-1 overflow-hidden md:hidden">
          {activeTab === "editor" ? (
            <Editor
              value={content}
              onChange={handleContentChange}
              theme={theme}
              readOnly={isReadOnly}
              apiRef={editorApi}
              fontSize={fontSize}
              onZoomCommand={handleZoomCommand}
            />
          ) : (
            <div className="h-full overflow-auto">
              <MarkdownRenderer content={content} theme={theme} />
            </div>
          )}
        </div>

        {/* Desktop View: Split / Editor only / Preview only */}
        <div className="hidden md:flex flex-1 overflow-hidden editor-preview-container">
          {viewMode !== "preview" && (
            <div
              style={{
                width: viewMode === "editor" ? "100%" : `${editorWidth}%`,
              }}
              className="overflow-hidden"
            >
              <Editor
                value={content}
                onChange={setContent}
                theme={theme}
                readOnly={isReadOnly}
                apiRef={editorApi}
                fontSize={fontSize}
                onZoomCommand={handleZoomCommand}
              />
            </div>
          )}

          {viewMode === "split" && (
            <div
              onMouseDown={() => setIsResizing(true)}
              className="w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-shrink-0 relative group"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          )}

          {viewMode !== "editor" && (
            <div
              style={{
                width:
                  viewMode === "preview" ? "100%" : `${100 - editorWidth}%`,
              }}
              className="overflow-auto"
            >
              <MarkdownRenderer content={content} theme={theme} />
            </div>
          )}
        </div>
      </div>

      {/* Overlay drag & drop */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/85 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-primary/60 rounded-xl px-10 py-8 text-center">
            <p className="text-sm font-medium">Drop file to open</p>
            <p className="text-xs text-muted-foreground mt-1">
              .md or .txt — max 1 MB
            </p>
          </div>
        </div>
      )}

      {/* Konfirmasi Clear: hanya untuk catatan yang sudah tersimpan di server */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-title"
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                <Eraser className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h2 id="clear-title" className="text-sm font-semibold">
                  Kosongkan editor?
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Isi editor akan dihapus. Catatan yang sudah tersimpan tetap aman
                  di server sampai kamu menekan{" "}
                  <span className="font-medium text-foreground">Save</span>.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmClear(false)}
              >
                Batal
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
                onClick={() => {
                  applyClear();
                  setConfirmClear(false);
                }}
              >
                Kosongkan
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview tersembunyi: sumber HTML untuk export */}
      <div ref={exportRef} className="hidden" aria-hidden="true">
        <MarkdownRenderer content={content} theme={theme} />
      </div>

      <VaultDialog
        open={showVault}
        onClose={() => {
          setShowVault(false);
          setVaultName(getVaultSession()?.name ?? null);
          setDocumentHistory(getDocumentHistory());
        }}
        onChanged={() => {
          setDocumentHistory(getDocumentHistory());
          setVaultName(getVaultSession()?.name ?? null);
        }}
      />

      <Footer />
    </div>
  );
}
