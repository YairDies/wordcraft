import { Tab, TabList, Toolbar, makeStyles, tokens } from "@fluentui/react-components";
import { useKeytipRef } from "@fluentui-contrib/react-keytips";
import { RIBBON } from "./curated";
import { RibbonButton } from "./RibbonButton";
import type { ShortcutApi } from "../keyboard/shortcuts";

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
    alignItems: "flex-start",
    gap: "0",
    padding: "4px 6px 2px",
    minHeight: "84px",
    overflowX: "auto",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingInline: "8px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    ":last-child": { borderRight: "none" },
  },
  groupItems: { display: "flex", flexWrap: "wrap", gap: "2px", alignItems: "center", maxWidth: "260px" },
  groupLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
    whiteSpace: "nowrap",
  },
});

interface TabWithKeytipProps {
  id: string;
  keytip: string;
  label: string;
  onSelect: (id: string) => void;
}

/** A tab carries the first-level keytip: Alt+H opens Home. */
function RibbonTabButton({ id, keytip, label, onSelect }: TabWithKeytipProps) {
  const keytipRef = useKeytipRef({
    keySequences: [keytip],
    // An empty string, not the sequence: the library renders `content` inside the tab, and the
    // tab then reads "FileFile" to a screen reader.
    content: "",
    onExecute: () => onSelect(id),
  });
  return (
    <Tab ref={keytipRef} value={id} title={`${label} (Alt+${keytip})`}>
      {label}
    </Tab>
  );
}

interface RibbonProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onRun: (id: string) => void;
  shortcuts: ShortcutApi;
}

/**
 * Word's ribbon: first-level keytips on the tabs, second-level keytips on the commands inside
 * them. Every button is created with its keytip and accelerator, from the same keyboard map.
 */
export function Ribbon({ activeTab, onSelectTab, onRun, shortcuts }: RibbonProps) {
  const styles = useStyles();
  const active = RIBBON.find((tab) => tab.id === activeTab) ?? RIBBON[0];
  const tabKeytip = shortcuts.keytipFor(active.id);

  return (
    <div className={styles.ribbon}>
      <TabList
        className={styles.tabs}
        size="small"
        selectedValue={active.id}
        onTabSelect={(_, data) => onSelectTab(String(data.value))}
        aria-label="Ribbon"
      >
        {RIBBON.map((tab) => (
          <RibbonTabButton
            key={tab.id}
            id={tab.id}
            keytip={shortcuts.keytipFor(tab.id)}
            label={shortcuts.labelFor(tab.id)}
            onSelect={onSelectTab}
          />
        ))}
      </TabList>
      <Toolbar className={styles.panel} aria-label={`${shortcuts.labelFor(active.id)} commands`}>
        {active.groups.map((group) => (
          <div key={group.id} className={styles.group} role="group" aria-label={group.label[shortcuts.locale]}>
            <div className={styles.groupItems}>
              {group.items.map((item) => (
                <RibbonButton
                  key={`${group.id}:${item.id}:${item.size}`}
                  id={item.id}
                  size={item.size}
                  tabKeytip={tabKeytip}
                  shortcuts={shortcuts}
                  onRun={onRun}
                />
              ))}
            </div>
            <span className={styles.groupLabel}>{group.label[shortcuts.locale]}</span>
          </div>
        ))}
      </Toolbar>
    </div>
  );
}
