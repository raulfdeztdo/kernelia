"use client";

// Consumed only via `components/admin/charts/index.tsx`, which wraps this
// export in `next/dynamic({ ssr: false })`. Recharts lives in a lazy
// chunk; the static import below is the implementation side.
// eslint-disable-next-line react-review/prefer-dynamic-import
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CHART_COLORS, TOOLTIP_STYLE } from "./chart-theme";

interface Props {
  classified: number;
  pending: number;
  failed: number;
  hidden: number;
}

/**
 * Donut breakdown of article status: classified / pending / failed / hidden.
 *
 * Distinct color per status — `failed` and `hidden` get their own tone (red
 * vs muted) so an operator can tell at a glance whether the failed slice is
 * dominated by LLM errors (failed/red) or deliberate human action
 * (hidden/muted gray). The 5-up Stat grid next to this chart carries the
 * exact numbers.
 *
 * If every bucket is zero (empty DB) we render a centered "Sin datos"
 * message instead of a degenerate ring.
 */
export function StatusDonut({ classified, pending, failed, hidden }: Props) {
  const total = classified + pending + failed + hidden;
  if (total === 0) {
    return (
      <div className="flex h-64 w-full items-center justify-center text-sm text-muted-foreground">
        Sin datos.
      </div>
    );
  }

  const data = [
    { name: "Classified", value: classified, color: CHART_COLORS.accent },
    { name: "Pending", value: pending, color: CHART_COLORS.axisLabel },
    { name: "Failed", value: failed, color: CHART_COLORS.red },
    { name: "Hidden", value: hidden, color: CHART_COLORS.muted },
  ];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={84}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: unknown, name: unknown) => {
              const n = typeof value === "number" ? value : Number(value ?? 0);
              return [`${n.toLocaleString()} (${pct(n, total)})`, String(name ?? "")];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}
