import { Button, makeStyles } from "@fluentui/react-components";
import type { ShortcutApi } from "../keyboard/shortcuts";
import { formatAccelerator, toAriaShortcut } from "../keyboard/shortcuts";
import { Keytip, KeytipAnchor } from "../keyboard/keytips";
import { iconFor } from "./icons";

const useStyles = makeStyles({
  large: {
    minWidth: "76px",
    height: "68px",
    flexDirection: "column",
    gap: "3px",
    paddingTop: "6px",
    paddingBottom: "4px",
  },
  small: { minWidth: "26px", height: "24px", minHeight: "24px", padding: "0 5px", fontSize: "11px" },
  largeLabel: { fontSize: "11px", lineHeight: "13px", textAlign: "center" },
  smallLabel: { fontSize: "11px", lineHeight: "12px" },
});

/** Icon sizes that match the ribbon's proportions: Word uses 32 px large, 20 px small. */
const ICON_SIZE = { large: 32, small: 20 } as const;

interface RibbonButtonProps {
  id: string;
  size: "large" | "small";
  /** The tab this button belongs to: the scope its keytip is displayed in. */
  tabId: string;
  shortcuts: ShortcutApi;
  active: boolean;
  onRun: (id: string) => void;
  disabled?: boolean;
}

/**
 * One ribbon command: icon, label, keytip and accelerator.
 *
 * The icon is decorative — the button's accessible name already describes the action — so it is
 * hidden from assistive technology rather than announced twice.
 */
export function RibbonButton({ id, size, tabId, shortcuts, active, onRun, disabled }: RibbonButtonProps) {
  const styles = useStyles();
  const label = shortcuts.labelFor(id);
  const accelerator = shortcuts.shortcutFor(id);
  const commandKeytip = shortcuts.keytipFor(id);
  const Icon = iconFor(id, active);
  const iconSize = ICON_SIZE[size];

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
        aria-keyshortcuts={accelerator ? toAriaShortcut(accelerator) : undefined}
        aria-pressed={active ? true : undefined}
      >
        {Icon ? (
          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center" }}>
            <Icon fontSize={iconSize} />
          </span>
        ) : null}
        <span className={size === "large" ? styles.largeLabel : styles.smallLabel}>{label}</span>
      </Button>
    </KeytipAnchor>
  );
}
