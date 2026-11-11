import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

// Ink-teal brand ramp taken from the Web App v2 design direction.
const brand: BrandVariants = {
  10: "#04100f",
  20: "#0a1f1e",
  30: "#0f2b2a",
  40: "#133735",
  50: "#174341",
  60: "#1a4f4c",
  70: "#1d5b58",
  80: "#1f5f5b",
  90: "#2c6f6b",
  100: "#3c807c",
  110: "#4f918d",
  120: "#65a29e",
  130: "#7fb3af",
  140: "#9bc4c1",
  150: "#b9d6d3",
  160: "#d9e8e6",
};

const base = createLightTheme(brand);

export const nbpraTheme: Theme = {
  ...base,
  fontFamilyBase: "'Fira Sans', 'Segoe UI', system-ui, sans-serif",
  fontFamilyMonospace: "'Fira Mono', Consolas, monospace",
  colorNeutralBackground1: "#fdfcf9",
  colorNeutralStroke1: "#d9d4c7",
  colorNeutralStrokeAccessible: "#8a8577",
  borderRadiusMedium: "3px",
};
