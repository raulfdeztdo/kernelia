/**
 * Shared color palette for admin dashboard charts. Recharts takes raw hex
 * strings (not CSS variables) because it inlines them into SVG attributes,
 * so we resolve the Tailwind tokens to literal values here. Keep these in
 * sync with the rest of the admin surface — accent teal, amber for warn,
 * red for failed, etc.
 */
export const CHART_COLORS = {
  /** Primary accent (teal-400) — matches `text-accent` in the dashboard. */
  accent: "#2dd4bf",
  /** Stacked-bar second segment, slightly desaturated. */
  accentSoft: "#5eead4",
  /** "Failed" tone — matches `text-red-300` / `text-red-400` family. */
  warn: "#fbbf24",
  red: "#f87171",
  /** "Hidden" tone — muted gray. */
  muted: "#9ca3af",
  emerald: "#34d399",
  /** Default chart axis / grid stroke. Dark theme low-contrast. */
  axis: "#475569",
  axisLabel: "#94a3b8",
  /** Surface color for tooltip backgrounds. */
  tooltipBg: "rgba(15, 23, 42, 0.95)",
  tooltipBorder: "#334155",
} as const;

/**
 * Common tooltip styling. Object literal that we spread into every chart's
 * `<Tooltip contentStyle>` prop so the look stays uniform.
 */
export const TOOLTIP_STYLE = {
  backgroundColor: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.tooltipBorder}`,
  borderRadius: 6,
  fontSize: 12,
} as const;

export const AXIS_TICK_STYLE = {
  fill: CHART_COLORS.axisLabel,
  fontSize: 11,
} as const;
