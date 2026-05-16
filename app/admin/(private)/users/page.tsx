import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listUsers } from "@/db/queries/users";
import { SESSION_COOKIE_NAME, getUserBySessionCookie } from "@/lib/auth/sessions";
import { AddUserForm } from "@/components/admin/add-user-form";
import { UserRowActions } from "@/components/admin/user-row-actions";

export const dynamic = "force-dynamic";

/**
 * `/admin/users` — admin-management surface. Lists every user (admin is the
 * only `user_type` for now), with the authenticated admin's own row marked
 * "tú mismo" so the destructive controls disappear. The server-side
 * guardrails in `db/queries/admin-users.ts` enforce the same rule plus the
 * "never zero active admins" invariant.
 */
export default async function AdminUsersPage() {
  // Re-read the session here (the layout doesn't pass it down) so we can
  // mark the current user's row as `isSelf`. This is the same cookie the
  // layout already validated, so it's cheap.
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getUserBySessionCookie(cookie);
  if (!session) {
    redirect("/admin/login");
  }
  const me = session.user;

  const users = await listUsers();

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <Link href="/admin" className="text-sm text-accent underline-offset-2 hover:underline">
          ← Panel
        </Link>
      </header>

      <p className="text-sm text-muted-foreground">
        Los usuarios añadidos aquí pueden entrar a{" "}
        <code className="text-xs">/admin/login</code>, pulsar &quot;¿olvidaste tu contraseña?&quot;
        y elegir su primera contraseña vía el enlace que recibirán por email. No se envía
        invitación automática.
      </p>

      <section className="rounded-md border border-border bg-surface p-4">
        <AddUserForm />
      </section>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Activo</th>
              <th className="px-3 py-2 font-medium">Último login</th>
              <th className="px-3 py-2 font-medium">Creado</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                  Sin usuarios.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === me.id;
                return (
                  <tr key={u.id} className="border-t border-border align-top last:border-b">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {u.email}
                      {isSelf ? (
                        <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          tú
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {u.userType}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {u.active ? (
                        <span className="inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                          activo
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                      {u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                      {u.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      <UserRowActions
                        userId={u.id}
                        email={u.email}
                        active={u.active}
                        isSelf={isSelf}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
