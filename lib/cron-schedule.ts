/**
 * Human-readable description of the cron schedule for the admin panel.
 *
 * The actual cadence is declared in `.github/workflows/cron.yml` (free
 * GitHub Actions scheduler) — Vercel Hobby caps custom crons at 1/day,
 * so we drive cadence from GHA and the Vercel routes are the recipients.
 *
 * Keep this string in sync with `cron.yml` by hand. There is no single
 * source of truth here because the cron expression syntax in YAML is
 * not consumable from TS without a parser dependency we don't want.
 * When you edit `cron.yml`, edit this file too — both files reference
 * each other in their respective comments.
 */
export const CRON_SCHEDULE = {
  ingest: {
    cron: "0 */3 * * *",
    description: "Cada 3 horas, en UTC múltiplo de 3 (00:00, 03:00, …, 21:00).",
  },
  classify: {
    cron: "*/30 * * * *",
    description: "Cada 30 minutos en :00 y :30.",
  },
  broadcast: {
    cron: "5 * * * *",
    description:
      "Cada hora en :05 UTC. El handler aplica la ventana Europe/Madrid (08-13 y 16-23) en runtime; fuera de ventana hace bail-out sin tocar DB. :05 evita la colision con classify (:00, :30) e ingest (:00 cada 3h) — GitHub deduplica triggers que coinciden en el mismo minuto.",
  },
  newsletter: {
    cron: "0 10 * * 0",
    description: "Domingos a las 10:00 UTC (digest semanal de la newsletter).",
  },
} as const;
