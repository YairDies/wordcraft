import { makeStyles, tokens } from "@fluentui/react-components";
import type { DocumentState } from "../bridge/engine";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    paddingInline: "12px",
    height: "26px",
    flexShrink: 0,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  left: { display: "flex", gap: "18px" },
  status: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

/** Word's status bar: where you are, and what the engine last said. */
export function StatusBar({ doc, zoom }: { doc: DocumentState | null; zoom: number }) {
  const styles = useStyles();
  const page = doc ? `Page 1 of ${Math.max(1, doc.pageCount)}` : "Page 1 of 1";
  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.left}>
        <span>{page}</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span>{doc?.dirty ? "Unsaved changes" : "Saved"}</span>
      </div>
      <span className={styles.status}>{doc?.status ?? ""}</span>
    </div>
  );
}
