"use client";

// Consumed only through `./index.tsx` (next/dynamic, ssr: false), so
// Recharts stays in a lazy chunk — see the note in `classified-line.tsx`.
// eslint-disable-next-line react-review/prefer-dynamic-import
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK_STYLE, CHART_COLORS, TOOLTIP_STYLE } from "./chart-theme";

type Channel = "telegram" | "mastodon" | "bluesky" | "newsletter";

interface AudienceRow {
  date: string;
  telegram?: number;
  mastodon?: number;
  bluesky?: number;
  newsletter?: number;
}

interface Props {
  /** One row per snapshot day, oldest first. */
  data: readonly AudienceRow[];
}

// Platform brand colours (same as the public header icons) so the
// lines read at a glance; newsletter uses the admin accent.
const LINES: { key: Channel; name: string; color: string }[] = [
  { key: "telegram", name: "Telegram", color: "#26A5E4" },
  { key: "mastodon", name: "Mastodon", color: "#6364FF" },
  { key: "bluesky", name: "Bluesky", color: "#0285FF" },
  { key: "newsletter", name: "Newsletter", color: CHART_COLORS.accent },
];

/** Seguidores por canal a lo largo del tiempo. */
export function AudienceLineChart({ data }: Props) {
  const series = data.map((d) => ({ ...d, date: d.date.slice(5) }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} />
          <YAxis stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: CHART_COLORS.axis }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {LINES.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              stroke={l.color}
              strokeWidth={2}
              dot={data.length <= 2}
              connectNulls
              name={l.name}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
