export function Footer({ newNoteHref }: { newNoteHref?: string }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
      <span>© {year} Catatan</span>
      {newNoteHref && (
        <>
          <span className="mx-2 opacity-40">·</span>
          <a
            href={newNoteHref}
            className="transition-colors hover:text-foreground hover:underline underline-offset-2"
          >
            Buat catatan baru
          </a>
        </>
      )}
    </footer>
  );
}
