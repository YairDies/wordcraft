import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Option,
  makeStyles,
} from "@fluentui/react-components";
import { COMMANDS } from "./map";
import type { ShortcutApi } from "./shortcuts";
import { formatAccelerator } from "./shortcuts";

const useStyles = makeStyles({
  rows: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
});

interface ShortcutDialogProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutApi;
}

/**
 * Basic keyboard customisation, the counterpart of Word's File ▸ Options ▸ Customise Ribbon ▸
 * Keyboard. Shortcuts are reassignable; keytips are not, which is why only the accelerator is
 * offered here.
 */
export function ShortcutDialog({ open, onClose, shortcuts }: ShortcutDialogProps) {
  const styles = useStyles();
  const [editing, setEditing] = useState<string>("format.bold");
  const [recorded, setRecorded] = useState<string>("");
  const [conflict, setConflict] = useState<string | null>(null);

  const record = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push("Mod");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    const key = event.key;
    if (["Control", "Meta", "Alt", "Shift"].includes(key)) return;
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    const accelerator = parts.join("+");
    setRecorded(accelerator);
    const owner = shortcuts.ownerOf(accelerator);
    setConflict(owner && owner !== editing ? owner : null);
  };

  const apply = () => {
    if (!recorded) return;
    shortcuts.assign(editing, recorded);
    setRecorded("");
    setConflict(null);
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface aria-describedby="shortcut-help">
        <DialogBody>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogContent>
            <p id="shortcut-help">
              Elige un comando y pulsa la combinación nueva. Los KeyTips de la cinta no se cambian:
              Word tampoco lo permite.
            </p>
            <div className={styles.rows}>
              <Field label="Comando">
                <Dropdown
                  value={shortcuts.labelFor(editing)}
                  selectedOptions={[editing]}
                  onOptionSelect={(_, data) => {
                    if (data.optionValue) setEditing(data.optionValue);
                    setRecorded("");
                    setConflict(null);
                  }}
                >
                  {COMMANDS.map((command) => (
                    <Option key={command.id} value={command.id} text={command.label[shortcuts.locale]}>
                      {command.label[shortcuts.locale]}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Atajo actual">
                <span>{formatAccelerator(shortcuts.shortcutFor(editing)) || "sin atajo"}</span>
              </Field>
              <Field label="Nuevo atajo" hint={conflict ? `Ya lo usa ${shortcuts.labelFor(conflict)}.` : "Pulsa una combinación con Ctrl, Alt o Mayús."}>
                <input
                  aria-label="Nuevo atajo"
                  readOnly
                  value={recorded ? formatAccelerator(recorded) : ""}
                  onKeyDown={record}
                  placeholder="Pulsa aquí y teclea la combinación"
                />
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => {
                shortcuts.reset(editing);
                setRecorded("");
                setConflict(null);
              }}
            >
              Restaurar
            </Button>
            <Button appearance="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button appearance="primary" onClick={apply} disabled={!recorded}>
              Asignar
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
