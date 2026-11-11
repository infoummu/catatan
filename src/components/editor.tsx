"use client";

import { Editor as MonacoEditor } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

export type FormatKind =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "link"
  | "ul"
  | "ol"
  | "quote"
  | "codeblock"
  | "hr";

export interface EditorHandle {
  format: (kind: FormatKind) => void;
  focus: () => void;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  theme?: "light" | "dark";
  readOnly?: boolean;
  /** Diisi oleh editor yang sedang tampil, dipakai toolbar di parent */
  apiRef?: MutableRefObject<EditorHandle | null>;
}

export function Editor({
  value,
  onChange,
  theme = "dark",
  readOnly = false,
  apiRef,
}: EditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const valueRef = useRef(value);
  const isUserChangeRef = useRef(false);

  function applyFormat(kind: FormatKind) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || readOnly) return;

    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;

    const R = monaco.Range;

    const wrap = (prefix: string, suffix: string) => {
      const text = model.getValueInRange(sel);
      const startLine = sel.startLineNumber;
      const startColumn = sel.startColumn;

      editor.executeEdits("toolbar", [
        { range: sel, text: prefix + text + suffix, forceMoveMarkers: true },
      ]);

      if (!text) {
        // taruh kursor di antara penanda
        editor.setPosition({
          lineNumber: startLine,
          column: startColumn + prefix.length,
        });
      } else if (startLine === sel.endLineNumber) {
        // tetap pilih teks aslinya supaya klik beruntun tidak menumpuk markup
        editor.setSelection(
          new R(
            startLine,
            startColumn + prefix.length,
            startLine,
            sel.endColumn + prefix.length,
          ),
        );
      }
      editor.focus();
    };

    const lines: number[] = [];
    for (let l = sel.startLineNumber; l <= sel.endLineNumber; l++) lines.push(l);

    // toggle prefiks per baris (list, quote)
    const prefixLines = (marker: string, pattern: RegExp) => {
      const removeAll = lines.every((l) => pattern.test(model.getLineContent(l)));
      const edits: any[] = [];
      for (const l of lines) {
        if (removeAll) {
          const m = model.getLineContent(l).match(pattern);
          if (m) {
            edits.push({ range: new R(l, 1, l, 1 + m[0].length), text: "" });
          }
        } else if (!pattern.test(model.getLineContent(l))) {
          edits.push({ range: new R(l, 1, l, 1), text: marker });
        }
      }
      if (edits.length) editor.executeEdits("toolbar", edits);
      editor.focus();
    };

    switch (kind) {
      case "bold":
        return wrap("**", "**");
      case "italic":
        return wrap("*", "*");
      case "strike":
        return wrap("~~", "~~");
      case "code":
        return wrap("`", "`");
      case "link": {
        const text = model.getValueInRange(sel);
        const startLine = sel.startLineNumber;
        const startColumn = sel.startColumn;
        editor.executeEdits("toolbar", [
          {
            range: sel,
            text: `[${text}](https://)`,
            forceMoveMarkers: true,
          },
        ]);
        if (!text) {
          // pilih placeholder https:// agar langsung bisa ditimpa
          editor.setSelection(
            new R(startLine, startColumn + 3, startLine, startColumn + 11),
          );
        }
        editor.focus();
        return;
      }
      case "codeblock":
        return wrap("```\n", "\n```");
      case "ul":
        return prefixLines("- ", /^\s*[-*+]\s+/);
      case "ol":
        return prefixLines("1. ", /^\s*\d+\.\s+/);
      case "quote":
        return prefixLines("> ", /^\s*>\s+/);
      case "h1":
      case "h2": {
        const level = kind === "h1" ? 1 : 2;
        const prefix = "#".repeat(level) + " ";
        const lineNo = sel.startLineNumber;
        const lineText = model.getLineContent(lineNo);
        const m = lineText.match(/^(#{1,6})\s+/);
        if (m && m[1].length === level) {
          editor.executeEdits("toolbar", [
            { range: new R(lineNo, 1, lineNo, 1 + m[0].length), text: "" },
          ]);
        } else if (m) {
          editor.executeEdits("toolbar", [
            { range: new R(lineNo, 1, lineNo, 1 + m[0].length), text: prefix },
          ]);
        } else {
          editor.executeEdits("toolbar", [
            { range: new R(lineNo, 1, lineNo, 1), text: prefix },
          ]);
        }
        editor.focus();
        return;
      }
      case "hr": {
        editor.executeEdits("toolbar", [
          { range: sel, text: "\n---\n", forceMoveMarkers: true },
        ]);
        editor.focus();
        return;
      }
    }
  }

  function handleEditorDidMount(editor: any, monaco: any) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure dark theme
    monaco.editor.defineTheme("markdown-dark", {
      base: "vs-dark",
      inherit: true,

      rules: [],
      colors: {
        "editor.background": "#141414",
        "editor.foreground": "#f2f2f2",
        "editor.lineHighlightBackground": "#1a1a1a",
        "editorCursor.foreground": "#f2f2f2",
        "editorLineNumber.foreground": "#666666",
        "editorLineNumber.activeForeground": "#999999",
      },
    });

    // Configure light theme
    monaco.editor.defineTheme("markdown-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1a1a1a",
        "editor.lineHighlightBackground": "#f5f5f5",
        "editorCursor.foreground": "#1a1a1a",
        "editorLineNumber.foreground": "#999999",
        "editorLineNumber.activeForeground": "#666666",
      },
    });

    monaco.editor.setTheme(
      theme === "dark" ? "markdown-dark" : "markdown-light",
    );

    // Shortcut format
    const KM = monaco.KeyMod;
    const KC = monaco.KeyCode;
    editor.addCommand(KM.CtrlCmd | KC.KeyB, () => applyFormat("bold"));
    editor.addCommand(KM.CtrlCmd | KC.KeyI, () => applyFormat("italic"));
    editor.addCommand(KM.CtrlCmd | KC.KeyK, () => applyFormat("link"));

    // Daftarkan API hanya untuk editor yang benar-benar tampil (mobile vs desktop)
    if (apiRef && editor.getDomNode()?.offsetParent !== null) {
      apiRef.current = { format: applyFormat, focus: () => editor.focus() };
    }
  }

  // Update theme when it changes
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(
        theme === "dark" ? "markdown-dark" : "markdown-light",
      );
    }
  }, [theme]);

  function handleEditorChange(newValue: string | undefined) {
    const val = newValue || "";
    isUserChangeRef.current = true;
    valueRef.current = val;
    onChange(val);
  }

  // Update editor value only when it changes externally (not from user typing)
  useEffect(() => {
    if (
      editorRef.current &&
      !isUserChangeRef.current &&
      value !== valueRef.current
    ) {
      const editor = editorRef.current;
      const model = editor.getModel();

      if (model) {
        // Save cursor position
        const position = editor.getPosition();
        const scrollTop = editor.getScrollTop();

        // Update value
        model.setValue(value);
        valueRef.current = value;

        // Restore cursor position if it's still valid
        if (position) {
          const lineCount = model.getLineCount();
          if (position.lineNumber <= lineCount) {
            editor.setPosition(position);
            editor.setScrollTop(scrollTop);
          }
        }
      }
    }
    isUserChangeRef.current = false;
  }, [value]);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="markdown"
      defaultValue={value}
      onChange={handleEditorChange}
      onMount={handleEditorDidMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        padding: { top: 16, bottom: 16 },
        lineHeight: 24,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        scrollbar: {
          vertical: "visible",
          horizontal: "visible",
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        readOnly: readOnly,
      }}
    />
  );
}
