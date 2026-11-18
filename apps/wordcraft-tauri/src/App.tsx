import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FluentProvider, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { getCatalog, getState, isTauri, runCommand } from "./bridge/engine";
import type { CommandSpec, DocumentState } from "./bridge/engine";
import { buildRibbon } from "./shell/ribbonModel";
import { Ribbon } from "./shell/Ribbon";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";
import { matchesShortcut } from "./a11y/shortcuts";
import { themes, type ThemeMode } from "./theme/themes";
import { DocxEditor } from "./editor/DocxEditor";
import type { EditorApi } from "./editor/DocxEditor";
import { applyEditorCommand } from "./editor/commands";
import { importDocxFile } from "./editor/openDocx";
import { wordcraftSchema } from "./editor/schema";

const useStyles = makeStyles({
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  document: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "24px",
    display: "flex",
    justifyContent: "center",
  },
  dropTarget: { outline: `2px dashed ${tokens.colorStrokeFocus2}`, outlineOffset: "-8px" },
});

export function App() {
  const styles = useStyles();
  const [catalog, setCatalog] = useState<CommandSpec[]>([]);
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [tab, setTab] = useState("Home");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [zoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const catalogRef = useRef<CommandSpec[]>([]);
  catalogRef.current = catalog;

  const editorApi = useRef<EditorApi>({ view: null, loadDocument: () => {}, focus: () => {} });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const tabs = useMemo(() => buildRibbon(catalog), [catalog]);

  const refresh = useCallback(async () => {
    try {
      setDoc(await getState());
    } catch {
      // The shell still works without the engine summary; the editor is the primary surface.
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setNotice("Running outside Tauri: the editor works, the engine bridge does not. Use pnpm app:dev.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const commands = await getCatalog();
        if (cancelled) return;
        setCatalog(commands);
        await refresh();
      } catch (problem) {
        if (!cancelled) setError(String(problem));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const openDocx = useCallback(async (file: File) => {
    try {
      setNotice(`Opening ${file.name}…`);
      const imported = await importDocxFile(file, wordcraftSchema);
      editorApi.current.loadDocument(imported.json);
      const dropped = imported.dropped.length ? ` (ignored: ${imported.dropped.slice(0, 6).join(", ")})` : "";
      setNotice(`${file.name} imported${dropped}`);
      editorApi.current.focus();
    } catch (problem) {
      setError(`${file.name} could not be opened: ${String(problem)}`);
      setNotice(null);
    }
  }, []);

  const run = useCallback(
    async (command: CommandSpec | string) => {
      const id = typeof command === "string" ? command : command.id;
      // The editing surface answers its own commands; everything else is the engine's.
      if (applyEditorCommand(id, editorApi.current.view)) {
        setError(null);
        return;
      }
      if (!isTauri()) {
        setError(`${id} needs the engine bridge.`);
        return;
      }
      try {
        await runCommand(id);
        setError(null);
        await refresh();
      } catch (problem) {
        setError(String(problem));
      }
    },
    [refresh],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Inside the editor, ProseMirror owns the keys; the shell must not steal them.
      if (target?.closest("input, textarea, [contenteditable='true'], .ProseMirror")) return;
      const match = catalogRef.current.find((command) => command.shortcut && matchesShortcut(event, command.shortcut));
      if (!match) return;
      event.preventDefault();
      void run(match);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);

  return (
    <FluentProvider theme={themes[theme]} className={styles.app} data-theme={theme}>
      <a className="skip-link" href="#wc-document">
        Skip to document
      </a>
      <TitleBar doc={doc} theme={theme} onThemeChange={setTheme} onRun={run} onOpen={() => fileInput.current?.click()} />
      <Ribbon tabs={tabs} activeTab={tab} onSelectTab={setTab} onRun={run} disabled={false} />
      <input
        ref={fileInput}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openDocx(file);
          event.target.value = "";
        }}
      />
      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : notice ? (
        <MessageBar intent="info">
          <MessageBarBody>{notice}</MessageBarBody>
        </MessageBar>
      ) : null}
      <span id="wc-editor-hint" hidden>
        Editing area. Use the ribbon or Word keyboard shortcuts to format the text.
      </span>
      <div
        id="wc-document"
        className={dragging ? `${styles.document} ${styles.dropTarget}` : styles.document}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void openDocx(file);
        }}
      >
        <DocxEditor apiRef={editorApi} />
      </div>
      <StatusBar doc={doc} zoom={zoom} />
    </FluentProvider>
  );
}
