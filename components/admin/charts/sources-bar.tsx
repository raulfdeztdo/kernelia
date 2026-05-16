"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK_STYLE, CHART_COLORS, TOOLTIP_STYLE } from "./chart-theme";

interface SourceRow {
  name: string;
  classified: number;
}

interface Props {
  /** Top-N sources by # classified in the window. Server-sorted desc. */
  data: readonly SourceRow[];
}

/**
 * Horizontal bar chart of the top sources by # of classified articles in
 * the last 30 days. Horizontal layout because source names are long — a
 * vertical layout truncates them or rotates the labels into illegibility.
 *
 * The chart inherits the server's ordering (desc), but Recharts renders
 * the first row at the bottom of a vertical-layout BarChart. Reverse so
 * the biggest source sits at the top.
 *
 * Height scales with row count so 3 sources don't get a 240px void of
 * whitespace while 10 don't get cramped.
 */
export function SourcesBarChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 w-full items-center justify-center text-sm text-muted-foreground">
        Sin actividad clasificada en los últimos 30 días.
      </div>
    );
  }
  const series = [...data].reverse(); // top source at the top of the chart
  const height = Math.max(160, 28 * data.length + 32);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart
          data={series}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke={CHART_COLORS.axis}
            tick={AXIS_TICK_STYLE}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={CHART_COLORS.axis}
            tick={AXIS_TICK_STYLE}
            width={140}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            formatter={(value: unknown) => [
              typeof value === "number" ? value.toLocaleString() : String(value ?? ""),
              "Classified",
            ]}
          />
          <Bar dataKey="classified" fill={CHART_COLORS.accent} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
