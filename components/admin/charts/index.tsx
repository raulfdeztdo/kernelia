"use client";

/**
 * Lazy wrappers para los charts del dashboard.
 *
 * recharts (~80kb minified) se descarga sólo cuando el componente entra
 * en pantalla: `next/dynamic` con `ssr: false` lo saca del chunk client
 * inicial de /admin y lo mete en uno aparte. El skeleton mantiene la
 * altura para evitar layout shift mientras llega el chunk.
 *
 * Los ficheros `classified-line.tsx`, `tokens-bar.tsx`, etc. siguen
 * existiendo con su lógica de recharts; este módulo es sólo la capa
 * de carga diferida.
 */
import dynamic from "next/dynamic";

function SkeletonH64() {
  return <div className="h-64 w-full" aria-hidden />;
}
function SkeletonH56() {
  return <div className="h-56 w-full" aria-hidden />;
}

export const ClassifiedLineChart = dynamic(
  () => import("./classified-line").then((m) => m.ClassifiedLineChart),
  { ssr: false, loading: SkeletonH64 },
);

export const TokensBarChart = dynamic(
  () => import("./tokens-bar").then((m) => m.TokensBarChart),
  { ssr: false, loading: SkeletonH64 },
);

export const StatusDonut = dynamic(
  () => import("./status-donut").then((m) => m.StatusDonut),
  { ssr: false, loading: SkeletonH56 },
);

export const SourcesBarChart = dynamic(
  () => import("./sources-bar").then((m) => m.SourcesBarChart),
  { ssr: false, loading: SkeletonH64 },
);

export const BroadcastsStackedBarChart = dynamic(
  () => import("./broadcasts-stacked-bar").then((m) => m.BroadcastsStackedBarChart),
  { ssr: false, loading: SkeletonH64 },
);
