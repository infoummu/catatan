/**
 * Ekspor dokumen markdown yang sudah ter-render menjadi HTML atau PDF (via print).
 * Tidak butuh dependensi tambahan: HTML diambil dari DOM preview.
 */

const BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 32px 24px 64px; max-width: 820px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px; line-height: 1.65; color: #1a1a1a; background: #ffffff;
  }
  h1,h2,h3,h4,h5,h6 { font-weight: 600; line-height: 1.3; margin: 1.6em 0 .6em; color: #111; }
  h1 { font-size: 2rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .3em; }
  h2 { font-size: 1.5rem; border-bottom: 1px solid #eee; padding-bottom: .25em; }
  h3 { font-size: 1.25rem; }
  h4 { font-size: 1.05rem; }
  p { margin: .7em 0; }
  a { color: #2563eb; text-decoration: underline; }
  strong { font-weight: 600; }
  ul, ol { padding-left: 1.6em; margin: .7em 0; }
  ul { list-style: disc; }
  ul ul { list-style: circle; }
  ol { list-style: decimal; }
  li { margin: .25em 0; }
  li > ul, li > ol { margin: .25em 0; }
  blockquote {
    margin: 1em 0; padding: .25em 0 .25em 1em;
    border-left: 3px solid #d4d4d4; color: #555; font-style: italic;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .9em; background: #f4f4f5; border: 1px solid #e4e4e7;
    border-radius: 4px; padding: .15em .35em;
  }
  pre {
    background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px;
    padding: 14px 16px; overflow-x: auto; margin: 1em 0; page-break-inside: avoid;
  }
  pre code { background: transparent; border: none; padding: 0; font-size: .875em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
  th, td { border: 1px solid #d8d8d8; padding: 8px 10px; text-align: left; }
  th { background: #f6f6f6; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
  .katex-display { overflow-x: auto; overflow-y: hidden; }
  @media print {
    @page { size: A4; margin: 16mm 14mm; }
    body { padding: 0; max-width: none; font-size: 11.5pt; }
    pre, blockquote, table { page-break-inside: avoid; }
    h1, h2, h3 { page-break-after: avoid; }
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css" />
<style>${BASE_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function safeFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "catatan";
}

export function downloadHtmlFile(title: string, bodyHtml: string): void {
  const html = buildHtmlDocument(title, bodyHtml);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(title)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * PDF dibuat lewat dialog print browser (Save as PDF), bukan library PDF:
 * hasil vektor, teks tetap bisa diseleksi, tanpa menambah ukuran bundle.
 */
export function printPdf(title: string, bodyHtml: string): boolean {
  const html = buildHtmlDocument(title, bodyHtml);
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;

  win.document.open();
  win.document.write(html);
  win.document.close();

  const trigger = () => {
    win.focus();
    win.print();
  };
  // beri waktu font/katex CSS termuat
  win.addEventListener("load", () => setTimeout(trigger, 300), { once: true });
  setTimeout(trigger, 1200);
  return true;
}
