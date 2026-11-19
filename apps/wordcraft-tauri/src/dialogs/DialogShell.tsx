import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Tab,
  TabList,
  makeStyles,
} from "@fluentui/react-components";
import type { ReactNode } from "react";

const useStyles = makeStyles({
  surface: { maxWidth: "620px", width: "620px" },
  panel: { paddingTop: "10px", minHeight: "220px" },
  preview: {
    border: "1px solid var(--colorNeutralStroke1)",
    borderRadius: "4px",
    padding: "10px",
    marginTop: "10px",
    textAlign: "center",
  },
});

export interface DialogTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface DialogShellProps {
  open: boolean;
  title: string;
  tabs: DialogTab[];
  onApply: () => void;
  onCancel: () => void;
  /** Shown under the tabs, as Word's preview box does. */
  preview?: ReactNode;
}

/**
 * The frame every Word dialog shares: a tab strip, Ctrl+Tab between tabs, Enter to accept and Esc
 * to cancel.
 *
 * Fluent's `Dialog` already traps focus, restores it to the element that opened it and closes on
 * Esc, so none of that is reimplemented here. What it does not do is Word's Ctrl+Tab — TabList
 * navigates with the arrow keys — so that is added explicitly.
 */
export function DialogShell({ open, title, tabs, onApply, onCancel, preview }: DialogShellProps) {
  const styles = useStyles();
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setActive(tabs[0]?.id ?? "");
  }, [open, tabs]);

  const move = useCallback(
    (delta: number) => {
      const index = Math.max(0, tabs.findIndex((tab) => tab.id === active));
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (next) setActive(next.id);
    },
    [active, tabs],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Word switches dialog tabs with Ctrl+Tab, not with Tab; Tab belongs to the fields.
    if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      move(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const target = event.target as HTMLElement;
      // Enter inside a button activates that button; anywhere else it accepts the dialog.
      if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
      event.preventDefault();
      onApply();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onCancel() : undefined)} modalType="modal">
      <DialogSurface className={styles.surface} onKeyDown={onKeyDown}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div ref={bodyRef}>
              <TabList selectedValue={active} onTabSelect={(_, data) => setActive(String(data.value))} aria-label={title}>
                {tabs.map((tab) => (
                  <Tab key={tab.id} value={tab.id}>
                    {tab.label}
                  </Tab>
                ))}
              </TabList>
              <div className={styles.panel} role="tabpanel" aria-label={tabs.find((t) => t.id === active)?.label ?? title}>
                {tabs.find((tab) => tab.id === active)?.content}
              </div>
              {preview ? <div className={styles.preview}>{preview}</div> : null}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onApply}>
              Aceptar
            </Button>
            <Button appearance="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
