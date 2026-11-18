import { Tab, TabList, Toolbar, makeStyles, tokens } from "@fluentui/react-components";
import type { CommandSpec } from "../bridge/engine";
import type { RibbonTab } from "./ribbonModel";
import { ariaShortcut, formatShortcut } from "../a11y/shortcuts";

const useStyles = makeStyles({
  ribbon: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  tabs: { paddingInline: "6px" },
  panel: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    padding: "4px 6px 2px",
    minHeight: "84px",
    // The engine exposes 674 commands and the ribbon renders whichever the active tab owns.
    // Until the curated Word ribbon lands, the panel scrolls instead of pushing the document
    // off the window.
    maxHeight: "190px",
    overflowY: "auto",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingInline: "6px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    ":last-child": { borderRight: "none" },
  },
  groupLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
    whiteSpace: "nowrap",
  },
  buttons: { display: "flex", flexWrap: "wrap", gap: "2px", alignItems: "center" },
});

interface RibbonProps {
  tabs: RibbonTab[];
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onRun: (command: CommandSpec) => void;
  disabled: boolean;
}

/**
 * Word's ribbon: a tab strip over one panel of command groups.
 *
 * Buttons are plain elements with a native `title` rather than Fluent Tooltips: a Tooltip renders
 * a portal per button, and with hundreds of ribbon commands those portals covered the document
 * and intercepted every click aimed at the editor.
 */
export function Ribbon({ tabs, activeTab, onSelectTab, onRun, disabled }: RibbonProps) {
  const styles = useStyles();
  const active = tabs.find((tab) => tab.name === activeTab) ?? tabs[0];
  if (!active) return null;

  return (
    <div className={styles.ribbon}>
      <TabList
        className={styles.tabs}
        size="small"
        selectedValue={active.name}
        onTabSelect={(_, data) => onSelectTab(String(data.value))}
        aria-label="Ribbon"
      >
        {tabs.map((tab) => (
          <Tab key={tab.name} value={tab.name}>
            {tab.name}
          </Tab>
        ))}
      </TabList>
      <Toolbar className={styles.panel} aria-label={`${active.name} commands`}>
        {active.groups.map((group) => (
          <div key={group.name} className={styles.group} role="group" aria-label={group.name}>
            <div className={styles.buttons}>
              {group.commands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  className="ribbon-button"
                  onClick={() => onRun(command)}
                  disabled={disabled}
                  aria-keyshortcuts={command.shortcut ? ariaShortcut(command.shortcut) : undefined}
                  title={command.shortcut ? `${command.label} (${formatShortcut(command.shortcut)})` : command.label}
                >
                  {command.label}
                </button>
              ))}
            </div>
            <span className={styles.groupLabel}>{group.name}</span>
          </div>
        ))}
      </Toolbar>
    </div>
  );
}
