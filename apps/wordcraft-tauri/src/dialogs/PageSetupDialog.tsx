import { useState } from "react";
import { Field, Input, Radio, RadioGroup, makeStyles } from "@fluentui/react-components";
import { DialogShell } from "./DialogShell";
import type { PageValues } from "./apply";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  wide: { gridColumn: "1 / -1" },
});

interface PageSetupDialogProps {
  open: boolean;
  initial: PageValues;
  onApply: (values: PageValues) => void;
  onCancel: () => void;
}

/** Word's Page Setup: Margins, Paper and Layout. */
export function PageSetupDialog({ open, initial, onApply, onCancel }: PageSetupDialogProps) {
  const styles = useStyles();
  const [values, setValues] = useState<PageValues>(initial);
  const set = <K extends keyof PageValues>(key: K, value: PageValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <DialogShell
      open={open}
      title="Configurar página"
      onApply={() => onApply(values)}
      onCancel={onCancel}
      tabs={[
        {
          id: "margins",
          label: "Márgenes",
          content: (
            <div className={styles.grid}>
              <Field label="Superior (pt)">
                <Input aria-label="Margen superior" type="number" value={String(values.top)} onChange={(_, d) => set("top", Number(d.value) || 0)} />
              </Field>
              <Field label="Inferior (pt)">
                <Input aria-label="Margen inferior" type="number" value={String(values.bottom)} onChange={(_, d) => set("bottom", Number(d.value) || 0)} />
              </Field>
              <Field label="Izquierdo (pt)">
                <Input aria-label="Margen izquierdo" type="number" value={String(values.left)} onChange={(_, d) => set("left", Number(d.value) || 0)} />
              </Field>
              <Field label="Derecho (pt)">
                <Input aria-label="Margen derecho" type="number" value={String(values.right)} onChange={(_, d) => set("right", Number(d.value) || 0)} />
              </Field>
              <Field label="Orientación" className={styles.wide}>
                <RadioGroup value={values.orientation} onChange={(_, data) => set("orientation", data.value as PageValues["orientation"])} aria-label="Orientación">
                  <Radio value="portrait" label="Vertical" />
                  <Radio value="landscape" label="Horizontal" />
                </RadioGroup>
              </Field>
            </div>
          ),
        },
        {
          id: "paper",
          label: "Papel",
          content: (
            <div className={styles.grid}>
              <Field label="Tamaño del papel">
                <Input aria-label="Tamaño del papel" defaultValue="Carta (8,5 × 11 pulg.)" />
              </Field>
              <Field label="Origen del papel">
                <Input aria-label="Origen del papel" defaultValue="Bandeja 1" />
              </Field>
            </div>
          ),
        },
        {
          id: "layout",
          label: "Diseño",
          content: (
            <div className={styles.grid}>
              <Field label="Sección">
                <Input aria-label="Sección" defaultValue="1" />
              </Field>
              <Field label="Alineación vertical">
                <Input aria-label="Alineación vertical" defaultValue="Superior" />
              </Field>
              <Field label="Encabezados y pies" className={styles.wide}>
                <Input aria-label="Encabezados y pies" defaultValue="Distintos en páginas impares y pares" />
              </Field>
            </div>
          ),
        },
      ]}
    />
  );
}
