import type { FluentIcon } from "@fluentui/react-icons";
import {
  ArrowRedoRegular,
  ArrowUndoRegular,
  ClipboardPasteRegular,
  CopyRegular,
  CutRegular,
  DocumentPageBreakRegular,
  SaveRegular,
  SearchRegular,
  TableRegular,
  TextAlignCenterRegular,
  TextAlignJustifyRegular,
  TextAlignLeftRegular,
  TextAlignRightRegular,
  TextBoldFilled,
  TextBoldRegular,
  TextBulletListFilled,
  TextBulletListRegular,
  TextItalicFilled,
  TextItalicRegular,
  TextNumberListLtrFilled,
  TextNumberListLtrRegular,
  TextStrikethroughFilled,
  TextStrikethroughRegular,
  TextUnderlineFilled,
  TextUnderlineRegular,
  WeatherSunnyRegular,
} from "@fluentui/react-icons";

/**
 * Icons for the curated ribbon.
 *
 * All of them come from @fluentui/react-icons — Fluent UI System Icons, MIT licensed, the same
 * family Microsoft 365 uses. The Office *product* marks (the Word logo and friends) are covered by
 * Microsoft's brand guidelines and are not MIT, so none of them appear here; the system set covers
 * every ribbon command.
 *
 * `Regular` is the resting state and `Filled` marks an active or selected command, which is the
 * Fluent 2 convention and what Word does when Bold is on.
 */
export interface CommandIcon {
  regular: FluentIcon;
  /** Only for commands that can be *on*: bold, italic, lists, alignment. */
  filled?: FluentIcon;
}

export const ICONS: Record<string, CommandIcon> = {
  // File
  "file.save": { regular: SaveRegular },

  // Clipboard
  "edit.cut": { regular: CutRegular },
  "edit.copy": { regular: CopyRegular },
  "edit.paste": { regular: ClipboardPasteRegular },

  // Font — the ones that can be on carry a filled form.
  "format.bold": { regular: TextBoldRegular, filled: TextBoldFilled },
  "format.italic": { regular: TextItalicRegular, filled: TextItalicFilled },
  "format.underline": { regular: TextUnderlineRegular, filled: TextUnderlineFilled },
  "format.strikethrough": { regular: TextStrikethroughRegular, filled: TextStrikethroughFilled },

  // Paragraph
  "para.bullets": { regular: TextBulletListRegular, filled: TextBulletListFilled },
  "para.numbering": { regular: TextNumberListLtrRegular, filled: TextNumberListLtrFilled },
  "para.alignLeft": { regular: TextAlignLeftRegular },
  "para.alignCenter": { regular: TextAlignCenterRegular },
  "para.alignRight": { regular: TextAlignRightRegular },
  "para.alignJustify": { regular: TextAlignJustifyRegular },

  // Editing
  "edit.find": { regular: SearchRegular },
  "edit.undo": { regular: ArrowUndoRegular },
  "edit.redo": { regular: ArrowRedoRegular },

  // Insert
  "insert.table": { regular: TableRegular },
  "insert.pageBreak": { regular: DocumentPageBreakRegular },

  // View
  "view.theme": { regular: WeatherSunnyRegular },
};

/** The icon for a command, preferring the filled form when the command is on. */
export function iconFor(id: string, active: boolean): FluentIcon | undefined {
  const entry = ICONS[id];
  if (!entry) return undefined;
  return active && entry.filled ? entry.filled : entry.regular;
}
