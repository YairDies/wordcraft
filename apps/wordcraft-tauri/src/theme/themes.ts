import { createDarkTheme, createLightTheme, teamsHighContrastTheme } from "@fluentui/react-components";
import type { BrandVariants, Theme } from "@fluentui/react-components";

/**
 * WordCraft's brand ramp, fed to Fluent 2's theme generators so every control picks up the same
 * accent, focus ring and hover states. The ramp is our own; it is not sampled from any product.
 */
const craftBlue: BrandVariants = {
  10: "#020305",
  20: "#111723",
  30: "#16263d",
  40: "#193253",
  50: "#1b3f6c",
  60: "#1b4c85",
  70: "#1d5a9f",
  80: "#2e68b0",
  90: "#4a78be",
  100: "#6688cb",
  110: "#8199d8",
  120: "#9baae5",
  130: "#b5bcf2",
  140: "#cecfff",
  150: "#e3e3ff",
  160: "#f3f3ff",
};

/** The three view themes the shell offers: light, dark and a high-contrast theme for low vision. */
export type ThemeMode = "light" | "dark" | "high-contrast";

export const themes: Record<ThemeMode, Theme> = {
  light: createLightTheme(craftBlue),
  dark: createDarkTheme(craftBlue),
  "high-contrast": teamsHighContrastTheme,
};

export const themeLabels: Record<ThemeMode, string> = {
  light: "White (light)",
  dark: "Dark grey",
  "high-contrast": "High contrast",
};
