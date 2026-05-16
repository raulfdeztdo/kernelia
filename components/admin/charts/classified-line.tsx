"use client";

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

interface ClassifiedDay {
  date: string;
  classified: number;
  failed: number;
}

interface Props {
  /** Raw data from `getClassifiedPerDay(N)`. Newest-first. */
  data: readonly ClassifiedDay[];
}

/**
 * Line chart: # articulos clasificados por dia (y failed como segunda
 * linea sutil). El operador detecta caidas en la cadencia y picos de
 * fallos del LLM de un vistazo.
 */
export function ClassifiedLineChart({ data }: Props) {
  const series = [...data].reverse().map((d) => ({
    date: shortDate(d.date),
    classified: d.classified,
    failed: d.failed,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={CHART_COLORS.axis} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} />
          <YAxis stroke={CHART_COLORS.axis} tick={AXIS_TICK_STYLE} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: CHART_COLORS.axis }}
            formatter={(value: unknown) =>
              typeof value === "number" ? value.toLocaleString() : String(value ?? "")
            }
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="classified"
            stroke={CHART_COLORS.accent}
            strokeWidth={2}
            dot={false}
            name="Classified"
          />
          <Line
            type="monotone"
            dataKey="failed"
            stroke={CHART_COLORS.red}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name="Failed"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}
