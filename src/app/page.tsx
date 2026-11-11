"use client";

import { useState, useEffect, useRef } from "react";
import type { DragEvent } from "react";
import { Editor } from "@/components/editor";
import type { EditorHandle, FormatKind } from "@/components/editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Footer } from "@/components/footer";
import { DocumentSidebar } from "@/components/document-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/contexts/theme-context";
import {
  Share2,
  FileText,
  Save,
  Copy,
  FilePlus,
  Menu,
  X,
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
} from "lucide-react";
import { downloadHtmlFile, printPdf } from "@/lib/export";
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

const DEFAULT_CONTENT = `# Welcome to Catatan

A zero-knowledge markdown editor with **LaTeX** support.

## Features

- Side-by-side editing and preview
- End-to-end encryption
- LaTeX math support
- GitHub Flavored Markdown
- Light and dark themes

## LaTeX Example

Inline math: $E = mc^2$

Display math:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## Code Example

\`\`\`javascript
function hello(name) {
  console.log(\`Hello, \${name}!\`);
}
\`\`\`

## Tables

| Feature | Supported |
|---------|-----------|
| Markdown | ✓ |
| LaTeX | ✓ |
| Encryption | ✓ |

Start editing to see your changes!
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
  const editorApi = useRef<EditorHandle | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  // Load document history on mount
  useEffect(() => {
    setDocumentHistory(getDocumentHistory());
  }, []);

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
        if (documentId && encryptionKey && writeToken && !isSaving && !isLoading) {
          handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [documentId, encryptionKey, writeToken, isSaving, isLoading, content]);

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

  // Create new share (first time or create new document)
  async function handleShare() {
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

      // Navigate to the new document URL (with write token)
      window.location.hash = `${id}#${keyString}&write=${token}`;

      toast({
        title: "Document created",
        description: "You can now share this document with others",
      });
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
    // Navigate to home (clear hash)
    window.location.hash = "";

    toast({
      title: "New document",
      description: "Started a new document",
    });
  }

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
      className="flex flex-col h-screen bg-background relative"
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
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
          >
            {sidebarOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <Menu className="w-4 h-4" />
            )}
          </Button>

          <FileText className="w-5 h-5" />
          <h1 className="text-base font-semibold">Catatan</h1>

          <span className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
            {!documentId ? (
              "Local draft"
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
            <div className="relative ml-4">
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

        <div className="flex items-center gap-2">
          <div className="relative">
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
                <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-md shadow-lg z-20 py-1">
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
                </div>
              </>
            )}
          </div>

          <Button
            onClick={toggleTheme}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
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

          {documentId ? (
            <>
              <Button
                onClick={handleNew}
                size="sm"
                variant="outline"
                className="gap-2"
                title="New document"
              >
                <FilePlus className="w-4 h-4" />
                <span className="hidden sm:inline">New</span>
              </Button>
              {writeToken ? (
                <Button
                  onClick={handleSave}
                  disabled={isSaving || isLoading}
                  size="sm"
                  className="gap-2"
                  title={isSaving ? "Saving..." : "Save document"}
                >
                  <Save className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {isSaving ? "Saving..." : "Save"}
                  </span>
                </Button>
              ) : (
                <div className="px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-md">
                  Read Only
                </div>
              )}
            </>
          ) : (
            <Button
              onClick={handleShare}
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
        </div>
      </header>

      {/* Toolbar format + mode tampilan */}
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1 overflow-x-auto">
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

        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5 flex-shrink-0">
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
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <>
            <div className="w-64 border-r border-border bg-card overflow-hidden">
              <DocumentSidebar
                documents={documentHistory}
                currentDocumentId={documentId}
                onSelectDocument={loadDocument}
                onDeleteDocument={deleteDocument}
              />
            </div>
            <Separator orientation="vertical" />
          </>
        )}

        {/* Mobile View: Single Panel with Tabs */}
        <div className="flex-1 overflow-hidden md:hidden">
          {activeTab === "editor" ? (
            <Editor
              value={content}
              onChange={setContent}
              theme={theme}
              readOnly={isReadOnly}
              apiRef={editorApi}
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

      {/* Preview tersembunyi: sumber HTML untuk export */}
      <div ref={exportRef} className="hidden" aria-hidden="true">
        <MarkdownRenderer content={content} theme={theme} />
      </div>

      <Footer />
    </div>
  );
}
