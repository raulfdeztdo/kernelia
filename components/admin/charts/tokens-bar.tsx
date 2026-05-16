"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK_STYLE, CHART_COLORS, TOOLTIP_STYLE } from "./chart-theme";

interface TokensDay {
  date: string;
  promptTokens: number;
  completionTokens: number;
}

interface Props {
  /** Raw data from `getTokensPerDay(N)`. Newest-first; we reverse for the chart. */
  data: readonly TokensDay[];
}

/**
 * Stacked bar chart: prompt vs completion tokens per UTC day.
 *
 * The server query returns newest-first (chart-unfriendly), so we reverse
 * a shallow copy here to render oldest-on-the-left. The trade-off is one
 * extra allocation per render; cheap and keeps the SQL output stable for
 * the existing table consumer.
 *
 * `ResponsiveContainer` makes the SVG fill its parent's width; we pin the
 * height so the dashboard layout doesn't jump on first paint.
 */
export function TokensBarChart({ data }: Props) {
  const series = [...data].reverse().map((d) => ({
    date: shortDate(d.date),
    prompt: d.promptTokens,
    completion: d.completionTokens,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} />
          <YAxis
            stroke={CHART_COLORS.axis}
            tick={AXIS_TICK_STYLE}
            tickFormatter={compactNumber}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            formatter={formatNumber}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="prompt" stackId="t" fill={CHART_COLORS.accent} name="Prompt" />
          <Bar
            dataKey="completion"
            stackId="t"
            fill={CHART_COLORS.accentSoft}
            name="Completion"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function shortDate(iso: string): string {
  // "2026-05-16" → "05-16". Keeps the X axis compact for 30 ticks.
  return iso.length >= 10 ? iso.slice(5) : iso;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Recharts types the `Tooltip.formatter` value as `unknown`-ish (string |
 * number | array of either). The data we feed in is always numeric, but
 * we widen the param to make TS happy.
 */
function formatNumber(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  return String(value ?? "");
}
