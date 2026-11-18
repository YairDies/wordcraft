import { useCallback, useEffect, useRef } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useKeytipRef } from "@fluentui-contrib/react-keytips";
import type { ShortcutApi } from "../keyboard/shortcuts";
import { formatAccelerator, toAriaShortcut } from "../keyboard/shortcuts";

const useStyles = makeStyles({
  large: { minWidth: "64px", height: "62px", flexDirection: "column", gap: "2px" },
  small: { minWidth: "40px", height: "20px" },
});

interface RibbonButtonProps {
  id: string;
  size: "large" | "small";
  tabKeytip: string;
  shortcuts: ShortcutApi;
  onRun: (id: string) => void;
  disabled?: boolean;
}

/**
 * One ribbon command.
 *
 * The button is created together with its keytip and its accelerator, both resolved from the
 * keyboard map, so a command cannot exist on the ribbon without a way to reach it from the
 * keyboard.
 */
export function RibbonButton({ id, size, tabKeytip, shortcuts, onRun, disabled }: RibbonButtonProps) {
  const styles = useStyles();
  const label = shortcuts.labelFor(id);
  const accelerator = shortcuts.shortcutFor(id);
  const commandKeytip = shortcuts.keytipFor(id);
  const node = useRef<HTMLElement | null>(null);

  const keytipRef = useKeytipRef({
    // Second level: the tab's sequence first, then the command's own.
    keySequences: tabKeytip && commandKeytip ? [tabKeytip, commandKeytip] : [tabKeytip || commandKeytip],
    content: commandKeytip || label,
    onExecute: () => onRun(id),
  });

  // The keytip hook writes its own key sequence into `aria-keyshortcuts`, which is not the
  // accelerator. Merging the two refs lets the accelerator be restored after the hook has set it.
  const setRef = useCallback(
    (element: HTMLElement | null) => {
      node.current = element;
      if (typeof keytipRef === "function") keytipRef(element as never);
      else if (keytipRef) (keytipRef as { current: HTMLElement | null }).current = element;
    },
    [keytipRef],
  );

  useEffect(() => {
    if (!accelerator) return;
    node.current?.setAttribute("aria-keyshortcuts", toAriaShortcut(accelerator));
  }, [accelerator]);

  return (
    <Button
      ref={setRef as never}
      appearance="subtle"
      className={size === "large" ? styles.large : styles.small}
      onClick={() => onRun(id)}
      disabled={disabled}
      title={accelerator ? `${label} (${formatAccelerator(accelerator)})` : label}
      aria-label={accelerator ? `${label}, ${formatAccelerator(accelerator)}` : label}
    >
      <span>{label}</span>
    </Button>
  );
}
