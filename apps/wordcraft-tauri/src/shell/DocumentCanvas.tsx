import { useEffect, useRef, useState } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { renderPage } from "../bridge/engine";

const useStyles = makeStyles({
  viewport: {
    flexGrow: 1,
    overflow: "auto",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
  },
  page: {
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
    display: "block",
    maxWidth: "100%",
  },
  notice: {
    color: tokens.colorNeutralForeground2,
    maxWidth: "520px",
    textAlign: "center",
    lineHeight: 1.5,
  },
});

interface DocumentCanvasProps {
  pageCount: number;
  zoom: number;
  dark: boolean;
  reloadKey: number;
}

/**
 * The document surface. Pages are rasterised by `wordcraft-render` behind the Tauri command and
 * drawn as images, so what the person sees is the engine's own typesetting rather than a browser
 * re-implementation of it.
 */
export function DocumentCanvas({ pageCount, zoom, dark, reloadKey }: DocumentCanvasProps) {
  const styles = useStyles();
  const [pages, setPages] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    setFailure(null);

    const load = async () => {
      const rendered: string[] = [];
      for (let index = 0; index < pageCount; index += 1) {
        try {
          rendered.push(await renderPage(index, zoom, dark));
        } catch (error) {
          if (!cancelled) setFailure(String(error));
          return;
        }
        if (cancelled || generation.current !== current) return;
      }
      if (!cancelled) setPages(rendered);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [pageCount, zoom, dark, reloadKey]);

  return (
    <div className={styles.viewport} role="region" aria-label="Document">
      {failure ? (
        <p className={styles.notice}>
          The document could not be drawn: {failure}
        </p>
      ) : pages.length === 0 ? (
        <p className={styles.notice}>Laying out the document…</p>
      ) : (
        pages.map((png, index) => (
          <img
            key={index}
            className={styles.page}
            src={`data:image/png;base64,${png}`}
            alt={`Page ${index + 1} of ${pages.length}`}
          />
        ))
      )}
    </div>
  );
}
