import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Divider, makeStyles, tokens } from "@fluentui/react-components";
import type { DocumentState } from "../bridge/engine";
import type { ShortcutApi } from "../keyboard/shortcuts";

const useStyles = makeStyles({
  view: {
    display: "flex",
    flexGrow: 1,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  nav: {
    width: "220px",
    flexShrink: 0,
    padding: "18px 0",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  navItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: "8px 22px",
    fontSize: "14px",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  navItemActive: {
    backgroundColor: tokens.colorNeutralBackground1,
    fontWeight: 600,
  },
  content: { flexGrow: 1, padding: "26px 34px", overflowY: "auto" },
  title: { fontSize: "20px", marginTop: 0, marginBottom: "14px" },
  recent: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" },
  recentItem: {
    textAlign: "left",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "4px",
    background: "transparent",
    padding: "8px 12px",
    cursor: "pointer",
  },
  actions: { display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" },
  hint: { color: tokens.colorNeutralForeground3, fontSize: "12px" },
});

export type BackstagePage =
  | "file.home"
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.print"
  | "file.share"
  | "file.export"
  | "file.close"
  | "file.options";

const PAGES: BackstagePage[] = [
  "file.home",
  "file.new",
  "file.open",
  "file.save",
  "file.saveAs",
  "file.print",
  "file.share",
  "file.export",
  "file.close",
  "file.options",
];

interface BackstageProps {
  shortcuts: ShortcutApi;
  doc: DocumentState | null;
  recents: string[];
  onCommand: (id: string) => void;
  onClose: () => void;
  notice?: string | null;
}

/**
 * Word's Backstage: the whole window, not a dialog.
 *
 * It replaces the document while it is open and answers to the keyboard on its own — arrows or Tab
 * through the left panel, Enter to open a page, Esc to leave. The panel is a `listbox` so a screen
 * reader announces the options and which one is current; the pages themselves are plain sections.
 */
export function Backstage({ shortcuts, doc, recents, onCommand, onClose, notice }: BackstageProps) {
  const styles = useStyles();
  const [active, setActive] = useState<BackstagePage>("file.home");
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The focus goes to the panel as soon as the Backstage opens, which is what lets a screen reader
  // read the options straight away.
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  const move = useCallback((delta: number) => {
    setActive((current) => {
      const index = PAGES.indexOf(current);
      const next = PAGES[(index + delta + PAGES.length) % PAGES.length];
      itemRefs.current[PAGES.indexOf(next)]?.focus();
      return next;
    });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      move(-1);
    }
  };

  const label = (id: BackstagePage) => shortcuts.labelFor(id);

  return (
    <div className={styles.view} onKeyDown={onKeyDown}>
      <nav
        className={styles.nav}
        role="listbox"
        aria-label="Archivo"
        aria-activedescendant={`backstage-${active}`}
      >
        {PAGES.map((page, index) => (
          <button
            key={page}
            id={`backstage-${page}`}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="option"
            aria-selected={page === active}
            className={`${styles.navItem} ${page === active ? styles.navItemActive : ""}`}
            onClick={() => setActive(page)}
            onDoubleClick={() => onCommand(page)}
          >
            {label(page)}
          </button>
        ))}
        <Divider style={{ margin: "8px 0" }} />
        <button type="button" className={styles.navItem} onClick={onClose}>
          Volver al documento (Esc)
        </button>
      </nav>

      <section className={styles.content} role="region" aria-label={label(active)}>
        <h2 className={styles.title}>{label(active)}</h2>
        {notice ? <p className={styles.hint}>{notice}</p> : null}
        <PageBody
          page={active}
          doc={doc}
          recents={recents}
          shortcuts={shortcuts}
          onCommand={onCommand}
        />
        <div className={styles.actions}>
          <Button appearance="primary" onClick={() => onCommand(active)}>
            Continuar
          </Button>
          <Button appearance="secondary" onClick={onClose}>
            Volver al documento
          </Button>
        </div>
      </section>
    </div>
  );
}

interface PageBodyProps {
  page: BackstagePage;
  doc: DocumentState | null;
  recents: string[];
  shortcuts: ShortcutApi;
  onCommand: (id: string) => void;
}

function PageBody({ page, doc, recents, shortcuts, onCommand }: PageBodyProps) {
  const styles = useStyles();
  switch (page) {
    case "file.home":
      return (
        <div>
          <p>{doc?.title ?? "Documento1"}</p>
          <p className={styles.hint}>
            {doc?.wordCount ?? 0} palabras · {doc?.pageCount ?? 1} página(s) · {doc?.dirty ? "cambios sin guardar" : "guardado"}
          </p>
        </div>
      );
    case "file.open":
      return (
        <div>
          <p>Documentos recientes</p>
          {recents.length ? (
            <div className={styles.recent}>
              {recents.map((name) => (
                <button key={name} type="button" className={styles.recentItem} onClick={() => onCommand("file.openRecent")}>
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>Todavía no hay documentos recientes.</p>
          )}
          <div className={styles.actions}>
            <Button appearance="primary" onClick={() => onCommand("file.open")}>
              Examinar…
            </Button>
          </div>
        </div>
      );
    case "file.options":
      return <p className={styles.hint}>Aquí vivirán los ajustes de la aplicación.</p>;
    case "file.close":
      return <p>Se cerrará el documento actual. Si hay cambios sin guardar se pedirá confirmación.</p>;
    case "file.export":
      return (
        <p className={styles.hint}>
          La exportación a PDF usará el motor (wordcraft-pdf). Todavía no está conectada; la estructura
          del panel ya está en su sitio.
        </p>
      );
    default:
      return (
        <p className={styles.hint}>
          Atajo: {shortcuts.shortcutFor("file.saveCopy") || "sin atajo"} para guardar una copia sin
          cambiar el documento actual.
        </p>
      );
  }
}
