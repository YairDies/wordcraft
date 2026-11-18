import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FluentProvider, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { Keytips } from "@fluentui-contrib/react-keytips";
import { getCatalog, getState, isTauri, runCommand } from "./bridge/engine";
import type { CommandSpec, DocumentState } from "./bridge/engine";
import { StatusBar } from "./shell/StatusBar";
import type { SyncSample } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";
import { themes, type ThemeMode } from "./theme/themes";
import { DocxEditor } from "./editor/DocxEditor";
import type { EditorApi } from "./editor/DocxEditor";
import { applyEditorCommand } from "./editor/commands";
import { importDocxFile } from "./editor/openDocx";
import { wordcraftSchema } from "./editor/schema";
import { Ribbon } from "./ribbon/Ribbon";
import { COMMANDS } from "./keyboard/map";
import { detectLocale, storeLocale } from "./keyboard/locale";
import type { Locale } from "./keyboard/locale";
import { matchesAccelerator, useShortcuts } from "./keyboard/shortcuts";
import { ShortcutDialog } from "./keyboard/ShortcutDialog";

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
  const [tab, setTab] = useState("tab.home");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [zoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shortcutDialog, setShortcutDialog] = useState(false);
  const [syncSample, setSyncSample] = useState<SyncSample | null>(null);

  const shortcuts = useShortcuts(locale);
  const catalogRef = useRef<CommandSpec[]>([]);
  catalogRef.current = catalog;
  const editorApi = useRef<EditorApi>({ view: null, loadDocument: () => {}, focus: () => {}, resync: () => {} });
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDoc(await getState());
    } catch {
      // The shell works without the engine summary; the editor is the primary surface.
    }
  }, []);

  useEffect(() => {
    storeLocale(locale);
  }, [locale]);

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
    async (id: string) => {
      // Tabs are shell navigation, not engine commands.
      if (id.startsWith("tab.")) {
        setTab(id);
        return;
      }
      if (id === "view.theme") {
        setTheme((current) => (current === "light" ? "dark" : current === "dark" ? "high-contrast" : "light"));
        return;
      }
      if (id === "file.save") {
        setNotice("Saving is not wired to the engine yet.");
        return;
      }
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
        editorApi.current.resync();
      } catch (problem) {
        setError(String(problem));
      }
    },
    [refresh],
  );

  /**
   * The keyboard, fed by the single map. The editor answers its own commands first; anything else
   * is the engine's. Accelerators are resolved per language and per the person's reassignments.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], .ProseMirror")) return;
      for (const command of COMMANDS) {
        const accelerator = shortcuts.shortcutFor(command.id);
        if (!accelerator) continue;
        if (!matchesAccelerator(event, accelerator)) continue;
        event.preventDefault();
        void run(command.id);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, shortcuts]);

  const tabs = useMemo(() => COMMANDS.filter((command) => command.id.startsWith("tab.")), []);

  return (
    <FluentProvider theme={themes[theme]} className={styles.app} data-theme={theme}>
      {/* Keytips must live once, at the root of the FluentProvider. Word's entry key is Alt
          alone; the package defaults to Alt-Meta, which is not what Word users press. */}
      <Keytips startSequence="alt" />
      <a className="skip-link" href="#wc-document">
        Skip to document
      </a>
      <TitleBar
        doc={doc}
        theme={theme}
        locale={locale}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        onRun={run}
        onOpen={() => fileInput.current?.click()}
        onOpenShortcuts={() => setShortcutDialog(true)}
      />
      <Ribbon activeTab={tab} onSelectTab={setTab} onRun={run} shortcuts={shortcuts} />
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
        Editing area. Use the ribbon, its keytips (Alt) or Word's keyboard shortcuts.
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
        <DocxEditor
          apiRef={editorApi}
          resolveShortcut={shortcuts.shortcutFor}
          onSynced={setSyncSample}
          onUnsupported={(reason) => setError(`That edit is not synchronised with the engine yet: ${reason}.`)}
        />
      </div>
      <StatusBar doc={doc} zoom={zoom} sync={syncSample} />
      <ShortcutDialog open={shortcutDialog} onClose={() => setShortcutDialog(false)} shortcuts={shortcuts} />
      <input type="hidden" value={tabs.length} readOnly />
    </FluentProvider>
  );
}
