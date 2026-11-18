import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FluentProvider, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { getCatalog, getState, isTauri, runCommand } from "./bridge/engine";
import type { CommandSpec, DocumentState } from "./bridge/engine";
import { buildRibbon } from "./shell/ribbonModel";
import { Ribbon } from "./shell/Ribbon";
import { DocumentCanvas } from "./shell/DocumentCanvas";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";
import { matchesShortcut } from "./a11y/shortcuts";
import { themes, type ThemeMode } from "./theme/themes";

const useStyles = makeStyles({
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

export function App() {
  const styles = useStyles();
  const [catalog, setCatalog] = useState<CommandSpec[]>([]);
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [tab, setTab] = useState("Home");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [zoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const catalogRef = useRef<CommandSpec[]>([]);
  catalogRef.current = catalog;

  const tabs = useMemo(() => buildRibbon(catalog), [catalog]);

  const refresh = useCallback(async () => {
    try {
      setDoc(await getState());
    } catch (problem) {
      setError(String(problem));
    }
  }, []);

  // The ribbon, the command palette and the keyboard are all fed by the engine at start-up.
  useEffect(() => {
    if (!isTauri()) {
      setError("This window is running outside Tauri. Start it with `pnpm app:dev` to reach the engine.");
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

  const run = useCallback(
    async (command: CommandSpec | string) => {
      const id = typeof command === "string" ? command : command.id;
      try {
        await runCommand(id);
        setError(null);
        await refresh();
        setReloadKey((key) => key + 1);
      } catch (problem) {
        setError(String(problem));
      }
    },
    [refresh],
  );

  // Word's keyboard shortcuts, taken from the engine's own registry rather than re-typed here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, [contenteditable='true']");
      if (typing) return;
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
      <a className="skip-link" href="#document-surface">
        Skip to document
      </a>
      <TitleBar doc={doc} theme={theme} onThemeChange={setTheme} onRun={run} />
      <Ribbon tabs={tabs} activeTab={tab} onSelectTab={setTab} onRun={run} disabled={catalog.length === 0} />
      {error ? (
        <MessageBar intent="warning">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div id="document-surface" style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <DocumentCanvas pageCount={doc?.pageCount ?? 1} zoom={zoom} dark={theme === "dark"} reloadKey={reloadKey} />
      </div>
      <StatusBar doc={doc} zoom={zoom} />
    </FluentProvider>
  );
}
