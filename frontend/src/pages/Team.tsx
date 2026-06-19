import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { OrgRole, User } from "../types";

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

  useEffect(() => {
    if (!orgId) return;
    api<User[]>(`/orgs/${orgId}/members`).then(setMembers).catch((e) => setError(e.message));
  }, [orgId]);

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
        <div className="page-header"><h1>Team</h1></div>
        <div className="card">You are not a member of an organization.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Team</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New member"}
        </button>
      </div>

      {showForm && (
        <form className="card form-inline" onSubmit={addMember}>
          <label>
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label>
            Full name
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <label>
            Role
            <select value={form.org_role} onChange={(e) => setForm({ ...form, org_role: e.target.value as OrgRole })}>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Adding…" : "Add member"}
          </button>
          <p className="muted" style={{ flexBasis: "100%" }}>{ROLE_HELP[form.org_role]}</p>
        </form>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>{m.full_name}</td>
                <td>
                  <select
                    value={m.org_role ?? "viewer"}
                    onChange={(e) => patchMember(m.id, { org_role: e.target.value as OrgRole })}
                    disabled={m.id === user?.id}
                    title={m.id === user?.id ? "You cannot change your own role" : ROLE_HELP[(m.org_role ?? "viewer") as OrgRole]}
                  >
                    {ORG_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={m.is_active ? "tag tag-green" : "tag tag-red"}>
                    {m.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <button
                    className="btn btn-ghost"
                    disabled={m.id === user?.id}
                    onClick={() => patchMember(m.id, { is_active: !m.is_active })}
                  >
                    {m.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
