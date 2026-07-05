import { Fragment, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Capability, OrgRole, PermissionMatrix, User } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ORG_ROLES: OrgRole[] = ["org_admin", "analyst", "creative", "reviewer", "viewer"];

const ROLE_HELP: Record<OrgRole, string> = {
  org_admin: "Manage members, roles, and all client access in the organization.",
  analyst: "Create clients, connect social channels, and set up campaigns.",
  creative: "Generate and edit content; submits posts for review (cannot publish).",
  reviewer: "Approve or reject content; only approved posts can be scheduled/published.",
  viewer: "Read-only access.",
};

export default function Team() {
  const { user } = useAuth();
  const orgId = user?.org_id ?? "";
  const [members, setMembers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", org_role: "creative" as OrgRole });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [permError, setPermError] = useState("");

  useEffect(() => {
    if (!orgId) return;
    api<User[]>(`/orgs/${orgId}/members`).then(setMembers).catch((e) => setError(e.message));
    api<PermissionMatrix>(`/orgs/${orgId}/permissions`).then(setMatrix).catch(() => setMatrix(null));
  }, [orgId]);

  async function toggleCap(role: OrgRole, capability: Capability, allowed: boolean) {
    if (role === "org_admin" || !matrix) return;
    setPermError("");
    setMatrix({ ...matrix, grid: { ...matrix.grid, [role]: { ...matrix.grid[role], [capability]: allowed } } });
    try {
      const updated = await api<PermissionMatrix>(`/orgs/${orgId}/permissions`, {
        method: "PUT",
        body: { updates: [{ role, capability, allowed }] },
      });
      setMatrix(updated);
    } catch (err) {
      setPermError(err instanceof Error ? err.message : "Could not update permissions");
      api<PermissionMatrix>(`/orgs/${orgId}/permissions`).then(setMatrix).catch(() => {});
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const member = await api<User>(`/orgs/${orgId}/members`, { method: "POST", body: form });
      setMembers((prev) => [...prev, member]);
      setForm({ email: "", full_name: "", password: "", org_role: "creative" });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  async function patchMember(id: string, body: Partial<{ org_role: OrgRole; is_active: boolean }>) {
    setError("");
    try {
      const updated = await api<User>(`/orgs/${orgId}/members/${id}`, { method: "PATCH", body });
      setMembers((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  if (!orgId) {
    return (
      <div>
        <div className="mb-5"><h1>Team</h1></div>
        <Card><CardContent className="pt-6">You are not a member of an organization.</CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1>Team</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New member</>}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <form onSubmit={addMember} className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="team-email">Email</Label>
                <Input id="team-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="team-name">Full name</Label>
                <Input id="team-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="team-password">Password</Label>
                <Input id="team-password" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="team-role">Role</Label>
                <select
                  id="team-role"
                  value={form.org_role}
                  onChange={(e) => setForm({ ...form, org_role: e.target.value as OrgRole })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {ORG_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add member"}
              </Button>
              <p className="basis-full text-sm text-muted-foreground">{ROLE_HELP[form.org_role]}</p>
            </form>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>All members</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{m.email}</td>
                  <td className="px-4 py-2.5">{m.full_name}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={m.org_role ?? "viewer"}
                      onChange={(e) => patchMember(m.id, { org_role: e.target.value as OrgRole })}
                      disabled={m.id === user?.id}
                      title={m.id === user?.id ? "You cannot change your own role" : ROLE_HELP[(m.org_role ?? "viewer") as OrgRole]}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    >
                      {ORG_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={m.is_active ? "success" : "destructive"}>
                      {m.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={m.id === user?.id}
                      onClick={() => patchMember(m.id, { is_active: !m.is_active })}
                    >
                      {m.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {matrix && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="mt-0 text-sm text-muted-foreground">
              What each role can do. The Org admin always has full access (locked).
            </p>
            {permError && (
              <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {permError}
              </div>
            )}
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Capability</th>
                  {matrix.roles.map((r) => (
                    <th key={r} className="px-4 py-2.5 text-center capitalize">
                      {r.replace("_", " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.capabilities.map((cap, i) => {
                  const prevGroup = i > 0 ? matrix.capabilities[i - 1].group : null;
                  return (
                    <Fragment key={cap.key}>
                      {cap.group !== prevGroup && (
                        <tr>
                          <td colSpan={matrix.roles.length + 1} className="pt-3.5 text-sm font-medium text-muted-foreground">
                            {cap.group}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">{cap.label}</td>
                        {matrix.roles.map((r) => (
                          <td key={r} className="px-4 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={matrix.grid[r]?.[cap.key] ?? false}
                              disabled={r === "org_admin"}
                              title={r === "org_admin" ? "Org admin always has every capability" : undefined}
                              onChange={(e) => toggleCap(r, cap.key, e.target.checked)}
                              className="size-4 accent-primary"
                            />
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
