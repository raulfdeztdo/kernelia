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

interface TrafficDay {
  day: string;
  pageviews: number;
  visitors: number;
}

interface Props {
  /** Continuous series, oldest first (gaps already filled with zeros). */
  data: readonly TrafficDay[];
}

/** Visitas y visitantes por día (Europe/Madrid). */
export function TrafficLineChart({ data }: Props) {
  const series = data.map((d) => ({
    date: d.day.slice(5),
    pageviews: d.pageviews,
    visitors: d.visitors,
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} />
          <YAxis stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: CHART_COLORS.axis }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="pageviews"
            stroke={CHART_COLORS.accent}
            strokeWidth={2}
            dot={false}
            name="Visitas"
          />
          <Line
            type="monotone"
            dataKey="visitors"
            stroke={CHART_COLORS.warn}
            strokeWidth={1.5}
            dot={false}
            name="Visitantes"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
