import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Toolbar,
  ToolbarButton,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowRedoRegular, ArrowUndoRegular, SaveRegular, WeatherSunnyRegular } from "@fluentui/react-icons";
import type { DocumentState } from "../bridge/engine";
import { themeLabels, type ThemeMode } from "../theme/themes";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "40px",
    flexShrink: 0,
    paddingInline: "8px",
    // Marks the strip as the window's drag handle, so the frameless window still moves.
    "WebkitAppRegion": "drag",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tools: { WebkitAppRegion: "no-drag" },
  title: {
    flexGrow: 1,
    textAlign: "center",
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

interface TitleBarProps {
  doc: DocumentState | null;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onRun: (id: string) => void;
}

/** The quick access bar and the document title, mirroring Word's title strip. */
export function TitleBar({ doc, theme, onThemeChange, onRun }: TitleBarProps) {
  const styles = useStyles();
  const label = doc ? `${doc.title}${doc.dirty ? " *" : ""} - WordCraft` : "WordCraft";
  return (
    <div className={styles.bar}>
      <Toolbar className={styles.tools} aria-label="Quick access toolbar" size="small">
        <ToolbarButton icon={<SaveRegular />} onClick={() => onRun("file.save")} aria-label="Save" title="Save" />
        <ToolbarButton icon={<ArrowUndoRegular />} onClick={() => onRun("edit.undo")} aria-label="Undo" title="Undo" />
        <ToolbarButton icon={<ArrowRedoRegular />} onClick={() => onRun("edit.redo")} aria-label="Redo" title="Redo" />
      </Toolbar>
      <span className={styles.title} role="heading" aria-level={1}>
        {label}
      </span>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton
            className={styles.tools}
            icon={<WeatherSunnyRegular />}
            aria-label="View theme"
            title="View theme"
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {(Object.keys(themeLabels) as ThemeMode[]).map((mode) => (
              <MenuItem key={mode} onClick={() => onThemeChange(mode)}>
                {themeLabels[mode]}
                {mode === theme ? " ✓" : ""}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
