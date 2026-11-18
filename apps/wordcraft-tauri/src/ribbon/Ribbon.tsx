import { Tab, TabList, Toolbar, makeStyles, tokens } from "@fluentui/react-components";
import { RIBBON } from "./curated";
import { RibbonButton } from "./RibbonButton";
import type { ShortcutApi } from "../keyboard/shortcuts";
import { Keytip, KeytipAnchor } from "../keyboard/keytips";

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
    padding: "4px 6px 2px",
    minHeight: "86px",
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
  groupItems: { display: "flex", flexWrap: "wrap", gap: "2px", alignItems: "center", maxWidth: "280px" },
  groupLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
    whiteSpace: "nowrap",
  },
});

interface RibbonProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onRun: (id: string) => void;
  shortcuts: ShortcutApi;
}

/**
 * Word's ribbon. First-level keytips sit on the tabs, second-level ones on the commands inside
 * them, both drawn by our own `Keytip` — no portal, no library attribute rewriting.
 */
export function Ribbon({ activeTab, onSelectTab, onRun, shortcuts }: RibbonProps) {
  const styles = useStyles();
  const active = RIBBON.find((tab) => tab.id === activeTab) ?? RIBBON[0];

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
          <Tab key={tab.id} value={tab.id} title={`${shortcuts.labelFor(tab.id)} (Alt, ${shortcuts.keytipFor(tab.id)})`}>
            <KeytipAnchor>
              <Keytip scope="root" sequence={shortcuts.keytipFor(tab.id)} placement="bottom" />
              <span>{shortcuts.labelFor(tab.id)}</span>
            </KeytipAnchor>
          </Tab>
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
                  tabId={active.id}
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
