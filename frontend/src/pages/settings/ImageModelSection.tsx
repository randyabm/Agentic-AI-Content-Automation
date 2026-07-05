import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../api";
import { useConfirm } from "@/components/ui/dialogs";
import type { ImageModel } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, IMAGE_PROVIDERS, ModelSelect } from "./shared";

const EMPTY_IMAGE_FORM = { display_name: "", provider: "openrouter", model_name: "", is_default: false };

export function ImageModelSection() {
  const confirm = useConfirm();
  const [models, setModels] = useState<ImageModel[]>([]);
  const [form, setForm] = useState<typeof EMPTY_IMAGE_FORM>(EMPTY_IMAGE_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ImageModel[]>("/image-models").then(setModels).catch((e) => setError(e.message));
  }, []);

  function applyDefault(list: ImageModel[], saved: ImageModel): ImageModel[] {
    return list.map((m) => (m.id === saved.id ? saved : saved.is_default ? { ...m, is_default: false } : m));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editId) {
        const updated = await api<ImageModel>(`/image-models/${editId}`, { method: "PATCH", body: form });
        setModels((prev) => applyDefault(prev, updated));
      } else {
        const created = await api<ImageModel>("/image-models", { method: "POST", body: form });
        setModels((prev) => [...applyDefault(prev, created).filter((m) => m.id !== created.id), created]);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save model");
    }
  }

  function resetForm() {
    setForm(EMPTY_IMAGE_FORM);
    setShowForm(false);
    setEditId(null);
  }

  function startEdit(m: ImageModel) {
    setForm({ display_name: m.display_name, provider: m.provider, model_name: m.model_name, is_default: m.is_default });
    setEditId(m.id);
    setShowForm(true);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const updated = await api<ImageModel>(`/image-models/${id}`, { method: "PATCH", body });
      setModels((prev) => applyDefault(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remove image model",
      description: "Remove this image model from the list?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/image-models/${id}`, { method: "DELETE" });
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Image generation models</CardTitle>
        <Button onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add model</>}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Admin-curated list. Keys come from <strong>Providers &amp; Keys</strong>; model IDs are fetched
          automatically per provider.
        </p>
        {error && <Alert kind="error">{error}</Alert>}

        {showForm && (
          <form onSubmit={submit} className="mb-4 rounded-xl border border-border bg-surface-alt p-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="img-prov">Provider</Label>
                <select
                  id="img-prov"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {IMAGE_PROVIDERS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <ModelSelect
                  provider={form.provider}
                  kind="image"
                  value={form.model_name}
                  onChange={(id) => setForm((f) => ({ ...f, model_name: id }))}
                  onModelName={(name) => setForm((f) => (f.display_name ? f : { ...f, display_name: name }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="img-name">Display name</Label>
                <Input id="img-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
              </div>
              <label className="flex flex-row items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="size-4 accent-primary" />
                Default
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" disabled={!form.model_name}>
                {editId ? "Save changes" : "Add"}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Model ID</th>
              <th className="px-4 py-2.5">Default</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{m.display_name}</td>
                <td className="px-4 py-2.5">{m.provider}</td>
                <td className="px-4 py-2.5 font-mono">{m.model_name}</td>
                <td className="px-4 py-2.5">
                  {m.is_default ? (
                    <Badge variant="success">default</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_default: true })}>
                      Make default
                    </Button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                    {m.is_active ? "✓ active" : "✗ inactive"}
                  </Button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => remove(m.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-2.5 text-muted-foreground">
                  No image models yet. Add one to enable image generation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
