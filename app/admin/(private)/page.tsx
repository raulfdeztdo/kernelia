/**
 * Admin landing. Stub until sub-phase 7.C wires up the dashboard with real
 * metrics. The point of this stub is that 7.B's closing criterion can be
 * verified: after consuming a magic-link the user lands here, sees their
 * email in the header (from the layout), and the page does not 404.
 */
export default function AdminHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Panel de administración</h1>
      <p className="text-sm text-muted-foreground">
        Estás dentro. El panel completo (métricas, monitor del cron, gestión de
        artículos y usuarios) llega en las próximas sub-fases (7.C → 7.E).
      </p>
    </div>
  );
}
