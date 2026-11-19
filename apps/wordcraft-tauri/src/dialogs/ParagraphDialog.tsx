import { useState } from "react";
import { Checkbox, Field, Input, Radio, RadioGroup, makeStyles } from "@fluentui/react-components";
import { DialogShell } from "./DialogShell";
import type { ParagraphValues } from "./apply";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  wide: { gridColumn: "1 / -1" },
});

interface ParagraphDialogProps {
  open: boolean;
  initial: ParagraphValues;
  onApply: (values: ParagraphValues) => void;
  onCancel: () => void;
}

/** Word's Paragraph dialog: Indents and Spacing, and Line and Page Breaks. */
export function ParagraphDialog({ open, initial, onApply, onCancel }: ParagraphDialogProps) {
  const styles = useStyles();
  const [values, setValues] = useState<ParagraphValues>(initial);
  const set = <K extends keyof ParagraphValues>(key: K, value: ParagraphValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <DialogShell
      open={open}
      title="Párrafo"
      onApply={() => onApply(values)}
      onCancel={onCancel}
      tabs={[
        {
          id: "indents",
          label: "Sangría y espaciado",
          content: (
            <div className={styles.grid}>
              <Field label="Alineación" className={styles.wide}>
                <RadioGroup value={values.align} onChange={(_, data) => set("align", data.value as ParagraphValues["align"])} aria-label="Alineación">
                  <Radio value="left" label="Izquierda" />
                  <Radio value="center" label="Centrada" />
                  <Radio value="right" label="Derecha" />
                  <Radio value="justify" label="Justificada" />
                </RadioGroup>
              </Field>
              <Field label="Sangría izquierda (pt)">
                <Input aria-label="Sangría izquierda" type="number" value={String(values.indentLeft)} onChange={(_, d) => set("indentLeft", Number(d.value) || 0)} />
              </Field>
              <Field label="Sangría derecha (pt)">
                <Input aria-label="Sangría derecha" type="number" value={String(values.indentRight)} onChange={(_, d) => set("indentRight", Number(d.value) || 0)} />
              </Field>
              <Field label="Sangría de primera línea (pt)">
                <Input aria-label="Sangría de primera línea" type="number" value={String(values.indentFirst)} onChange={(_, d) => set("indentFirst", Number(d.value) || 0)} />
              </Field>
              <Field label="Interlineado">
                <Input aria-label="Interlineado" type="number" step="0.1" value={String(values.lineHeight)} onChange={(_, d) => set("lineHeight", Number(d.value) || 1)} />
              </Field>
              <Field label="Espaciado anterior (pt)">
                <Input aria-label="Espaciado anterior" type="number" value={String(values.spaceBefore)} onChange={(_, d) => set("spaceBefore", Number(d.value) || 0)} />
              </Field>
              <Field label="Espaciado posterior (pt)">
                <Input aria-label="Espaciado posterior" type="number" value={String(values.spaceAfter)} onChange={(_, d) => set("spaceAfter", Number(d.value) || 0)} />
              </Field>
            </div>
          ),
        },
        {
          id: "breaks",
          label: "Líneas y saltos de página",
          content: (
            <div>
              <Checkbox label="Control de viudas y huérfanas" defaultChecked />
              <Checkbox label="Mantener con el siguiente" />
              <Checkbox label="Mantener las líneas juntas" />
              <Checkbox label="Salto de página anterior" />
              <Checkbox label="No dividir con guiones" />
              <Checkbox label="No agregar espacio entre párrafos del mismo estilo" />
            </div>
          ),
        },
      ]}
    />
  );
}
