import { useState } from "react";
import { Checkbox, Field, Input, Radio, RadioGroup, makeStyles } from "@fluentui/react-components";
import { DialogShell } from "./DialogShell";
import type { FontValues } from "./apply";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  wide: { gridColumn: "1 / -1" },
});

const FAMILIES = ["Calibri", "Arial", "Times New Roman", "Georgia", "Consolas"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 32];

interface FontDialogProps {
  open: boolean;
  initial: FontValues;
  onApply: (values: FontValues) => void;
  onCancel: () => void;
}

/** Word's Font dialog: the Font tab and the Advanced tab, applied to the selection. */
export function FontDialog({ open, initial, onApply, onCancel }: FontDialogProps) {
  const styles = useStyles();
  const [values, setValues] = useState<FontValues>(initial);

  const set = <K extends keyof FontValues>(key: K, value: FontValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <DialogShell
      open={open}
      title="Fuente"
      onApply={() => onApply(values)}
      onCancel={onCancel}
      preview={<span style={{ fontFamily: values.family, fontSize: `${values.size}pt` }}>AaBbCc 123</span>}
      tabs={[
        {
          id: "font",
          label: "Fuente",
          content: (
            <div className={styles.grid}>
              <Field label="Fuente">
                <Input aria-label="Fuente" value={values.family} onChange={(_, data) => set("family", data.value)} list="wc-fonts" />
              </Field>
              <Field label="Estilo">
                <Input aria-label="Tamaño" type="number" value={String(values.size)} onChange={(_, data) => set("size", Number(data.value) || 11)} />
              </Field>
              <Field label="Color" className={styles.wide}>
                <Input aria-label="Color" value={values.color} onChange={(_, data) => set("color", data.value)} placeholder="#000000" />
              </Field>
              <div className={styles.wide}>
                <Checkbox label="Negrita" checked={values.bold} onChange={(_, data) => set("bold", Boolean(data.checked))} />
                <Checkbox label="Cursiva" checked={values.italic} onChange={(_, data) => set("italic", Boolean(data.checked))} />
                <Checkbox label="Subrayado" checked={values.underline} onChange={(_, data) => set("underline", Boolean(data.checked))} />
                <Checkbox label="Tachado" checked={values.strike} onChange={(_, data) => set("strike", Boolean(data.checked))} />
              </div>
              <datalist id="wc-fonts">
                {FAMILIES.map((family) => (
                  <option key={family} value={family} />
                ))}
              </datalist>
              <datalist id="wc-sizes">
                {SIZES.map((size) => (
                  <option key={size} value={size} />
                ))}
              </datalist>
            </div>
          ),
        },
        {
          id: "advanced",
          label: "Avanzado",
          content: (
            <div className={styles.grid}>
              <Field label="Escala" hint="Porcentaje del ancho natural">
                <Input aria-label="Escala" type="number" defaultValue="100" />
              </Field>
              <Field label="Espaciado" hint="Puntos">
                <Input aria-label="Espaciado" type="number" defaultValue="0" />
              </Field>
              <Field label="Posición" hint="Puntos">
                <Input aria-label="Posición" type="number" defaultValue="0" />
              </Field>
              <Field label="Kerning">
                <RadioGroup defaultValue="auto" aria-label="Kerning">
                  <Radio value="auto" label="Automático" />
                  <Radio value="none" label="Ninguno" />
                </RadioGroup>
              </Field>
            </div>
          ),
        },
      ]}
    />
  );
}
