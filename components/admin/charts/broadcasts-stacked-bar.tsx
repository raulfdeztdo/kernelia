"use client";

// Consumed only via `components/admin/charts/index.tsx`, which wraps this
// export in `next/dynamic({ ssr: false })`. Recharts lives in a lazy
// chunk; the static import below is the implementation side.
// eslint-disable-next-line react-review/prefer-dynamic-import
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

interface BroadcastsDay {
  date: string;
  mastodon: number;
  bluesky: number;
  telegram: number;
}

interface Props {
  /** Output of `getBroadcastsPerDay(N)`. Newest-first; reversed for the X axis. */
  data: readonly BroadcastsDay[];
}

/**
 * Stacked bar chart: posts per platform per UTC day.
 *
 * Each platform gets its own brand-ish color (kept in the chart palette
 * rather than the broadcaster's `simple-icons` hex so it harmonises with
 * the rest of the admin: the admin chart palette is a single visual
 * system, not a logo wall). Same reverse-shallow-copy trick as the tokens
 * chart so oldest sits left and the SQL output stays stable for tables.
 */
export function BroadcastsStackedBarChart({ data }: Props) {
  const series = [...data].reverse().map((d) => ({
    date: shortDate(d.date),
    mastodon: d.mastodon,
    bluesky: d.bluesky,
    telegram: d.telegram,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} />
          <YAxis stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            formatter={formatNumber}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="mastodon" stackId="b" fill={CHART_COLORS.accent} name="Mastodon" />
          <Bar dataKey="bluesky" stackId="b" fill={CHART_COLORS.emerald} name="Bluesky" />
          <Bar dataKey="telegram" stackId="b" fill={CHART_COLORS.accentSoft} name="Telegram" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

function formatNumber(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  return String(value ?? "");
}
