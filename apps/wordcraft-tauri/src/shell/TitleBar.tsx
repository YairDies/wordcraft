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
import { ArrowRedoRegular, ArrowUndoRegular, FolderOpenRegular, SaveRegular, WeatherSunnyRegular } from "@fluentui/react-icons";
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
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
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
  onOpen: () => void;
}

/** The quick access bar and the document title, mirroring Word's title strip. */
export function TitleBar({ doc, theme, onThemeChange, onRun, onOpen }: TitleBarProps) {
  const styles = useStyles();
  const label = doc ? `${doc.title}${doc.dirty ? " *" : ""} - WordCraft` : "WordCraft";
  return (
    <div className={styles.bar}>
      <Toolbar aria-label="Quick access toolbar" size="small">
        <ToolbarButton
          icon={<FolderOpenRegular />}
          onClick={onOpen}
          aria-label="Open a .docx file"
          title="Open"
          aria-keyshortcuts="Control+O"
        />
        <ToolbarButton icon={<SaveRegular />} onClick={() => onRun("file.save")} aria-label="Save" title="Save" aria-keyshortcuts="Control+S" />
        <ToolbarButton icon={<ArrowUndoRegular />} onClick={() => onRun("edit.undo")} aria-label="Undo" title="Undo" aria-keyshortcuts="Control+Z" />
        <ToolbarButton icon={<ArrowRedoRegular />} onClick={() => onRun("edit.redo")} aria-label="Redo" title="Redo" aria-keyshortcuts="Control+Y" />
      </Toolbar>
      <span className={styles.title} role="heading" aria-level={1}>
        {label}
      </span>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton icon={<WeatherSunnyRegular />} aria-label="View theme" title="View theme" />
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
