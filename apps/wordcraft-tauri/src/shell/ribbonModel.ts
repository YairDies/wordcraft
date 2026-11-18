import type { CommandSpec } from "../bridge/engine";

export interface RibbonGroup {
  name: string;
  commands: CommandSpec[];
}

export interface RibbonTab {
  name: string;
  groups: RibbonGroup[];
}

/** Word's tab order; anything the engine adds later is appended after these. */
const TAB_ORDER = ["File", "Home", "Insert", "Draw", "Design", "Layout", "References", "Mailings", "Review", "View", "Help"];

/**
 * Turn the engine's flat command list into Word's ribbon: tabs, then groups inside each tab.
 * A command's `location` is `"Home › Font"`; a location with no group (`"File"`) gets one named
 * after the tab so it still has somewhere to live.
 */
export function buildRibbon(catalog: CommandSpec[]): RibbonTab[] {
  const tabs = new Map<string, Map<string, CommandSpec[]>>();
  for (const command of catalog) {
    const [tab, group] = splitLocation(command.location);
    if (!tab) continue;
    const groups = tabs.get(tab) ?? new Map<string, CommandSpec[]>();
    const commands = groups.get(group) ?? [];
    commands.push(command);
    groups.set(group, commands);
    tabs.set(tab, groups);
  }
  const rank = (name: string) => {
    const index = TAB_ORDER.indexOf(name);
    return index === -1 ? TAB_ORDER.length : index;
  };
  return [...tabs.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, groups]) => ({ name, groups: [...groups.entries()].map(([g, commands]) => ({ name: g, commands })) }));
}

function splitLocation(location: string): [string, string] {
  const trimmed = location.trim();
  if (!trimmed) return ["", ""];
  const separator = trimmed.indexOf("›");
  if (separator === -1) return [trimmed, trimmed];
  return [trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()];
}
