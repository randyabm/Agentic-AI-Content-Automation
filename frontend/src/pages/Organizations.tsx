import { useEffect, useState } from "react";
import { api } from "../api";
import type { Organization } from "../types";

const EMPTY = { name: "", admin_email: "", admin_full_name: "", admin_password: "" };

export default function Organizations() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Organization[]>("/orgs").then(setOrgs).catch((e) => setError(e.message));
  }, []);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Only send the admin fields when an email+password were provided.
      const body: Record<string, unknown> = { name: form.name };
      if (form.admin_email && form.admin_password) {
        body.admin_email = form.admin_email;
        body.admin_full_name = form.admin_full_name;
        body.admin_password = form.admin_password;
      }
      const org = await api<Organization>("/orgs", { method: "POST", body });
      setOrgs((prev) => [...prev, org]);
      setForm(EMPTY);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Organizations</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New organization"}
        </button>
      </div>

      <p className="muted">
        Each organization is an isolated tenant: its members only ever see that
        organization's clients, campaigns, and connected channels.
      </p>

      {showForm && (
        <form className="card form-inline" onSubmit={createOrg}>
          <label>
            Organization name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            First admin email <span className="muted">(optional)</span>
            <input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
          </label>
          <label>
            Admin name
            <input value={form.admin_full_name} onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })} />
          </label>
          <label>
            Admin password
            <input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} minLength={8} />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Members</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td><code>{o.slug}</code></td>
                <td><span className="tag tag-green">{o.status}</span></td>
                <td>{o.member_count}</td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
