import { Button, makeStyles } from "@fluentui/react-components";
import type { ShortcutApi } from "../keyboard/shortcuts";
import { formatAccelerator, toAriaShortcut } from "../keyboard/shortcuts";
import { Keytip, KeytipAnchor } from "../keyboard/keytips";

const useStyles = makeStyles({
  large: {
    minWidth: "72px",
    height: "64px",
    flexDirection: "column",
    gap: "2px",
    paddingTop: "6px",
    paddingBottom: "4px",
  },
  small: { minWidth: "28px", height: "22px", minHeight: "22px", padding: "0 6px", fontSize: "11px" },
});

interface RibbonButtonProps {
  id: string;
  size: "large" | "small";
  /** The tab this button belongs to: the scope its keytip is displayed in. */
  tabId: string;
  shortcuts: ShortcutApi;
  onRun: (id: string) => void;
  disabled?: boolean;
}

/**
 * One ribbon command.
 *
 * The keytip badge is drawn by our own `Keytip`, so nothing overwrites `aria-keyshortcuts` and
 * nothing renders a portal. The button advertises its real accelerator, which is what a screen
 * reader announces.
 */
export function RibbonButton({ id, size, tabId, shortcuts, onRun, disabled }: RibbonButtonProps) {
  const styles = useStyles();
  const label = shortcuts.labelFor(id);
  const accelerator = shortcuts.shortcutFor(id);
  const commandKeytip = shortcuts.keytipFor(id);

  return (
    <KeytipAnchor>
      <Keytip scope={tabId} sequence={commandKeytip} />
      <Button
        appearance="subtle"
        className={size === "large" ? styles.large : styles.small}
        onClick={() => onRun(id)}
        disabled={disabled}
        title={accelerator ? `${label} (${formatAccelerator(accelerator)})` : label}
        aria-label={accelerator ? `${label}, ${formatAccelerator(accelerator)}` : label}
        // The accelerator, never the keytip sequence.
        aria-keyshortcuts={accelerator ? toAriaShortcut(accelerator) : undefined}
      >
        <span>{label}</span>
      </Button>
    </KeytipAnchor>
  );
}
