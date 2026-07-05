import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import type { Organization } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1>Organizations</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New organization</>}
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Each organization is an isolated tenant: its members only ever see that
        organization's clients, campaigns, and connected channels.
      </p>

      {showForm && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <form onSubmit={createOrg} className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="org-name">Organization name</Label>
                <Input id="org-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="org-admin-email">First admin email <span className="text-sm font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="org-admin-email" type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="org-admin-name">Admin name</Label>
                <Input id="org-admin-name" value={form.admin_full_name} onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })} />
              </div>
              <div className="flex-1 min-w-[180px] space-y-1.5">
                <Label htmlFor="org-admin-password">Admin password</Label>
                <Input id="org-admin-password" type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} minLength={8} />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create"}
              </Button>
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
        <CardHeader>
          <CardTitle>All organizations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Slug</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Members</th>
                <th className="px-4 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{o.name}</td>
                  <td className="px-4 py-2.5"><code className="font-mono text-xs">{o.slug}</code></td>
                  <td className="px-4 py-2.5"><Badge variant="success">{o.status}</Badge></td>
                  <td className="px-4 py-2.5">{o.member_count}</td>
                  <td className="px-4 py-2.5">{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
