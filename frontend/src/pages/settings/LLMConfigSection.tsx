import { useEffect, useState } from "react";
import { api } from "../../api";
import { TextareaZoom } from "../../components/TextareaZoom";
import type { LLMConfig } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, LLM_PROVIDERS, ModelSelect } from "./shared";

export function LLMConfigSection() {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<LLMConfig[]>("/llm-configs").then(setConfigs).catch((e) => setError(e.message));
  }, []);

  async function save() {
    if (!editing) return;
    setError("");
    try {
      const updated = await api<LLMConfig>(`/llm-configs/${editing.id}`, {
        method: "PATCH",
        body: {
          provider: editing.provider,
          model_name: editing.model_name,
          temperature: editing.temperature,
          max_tokens: editing.max_tokens,
          system_prompt: editing.system_prompt,
          is_active: editing.is_active,
        },
      });
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>LLM functions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pick a provider and model per function (PRD §9.1). The API key comes from the provider you
          set under <strong>Providers &amp; Keys</strong>.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Function</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Model</th>
              <th className="px-4 py-2.5">Temp</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{c.function.replaceAll("_", " ")}</td>
                <td className="px-4 py-2.5">{c.provider}</td>
                <td className="px-4 py-2.5 font-mono">{c.model_name}</td>
                <td className="px-4 py-2.5">{c.temperature}</td>
                <td className="px-4 py-2.5">{c.is_active ? "✓" : "✗"}</td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...c })}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editing && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-3">Edit: {editing.function.replaceAll("_", " ")}</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="llm-provider">Provider</Label>
                <select
                  id="llm-provider"
                  value={editing.provider}
                  onChange={(e) => setEditing({ ...editing, provider: e.target.value, model_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {LLM_PROVIDERS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <ModelSelect
                  provider={editing.provider}
                  kind="text"
                  value={editing.model_name}
                  onChange={(id) => setEditing({ ...editing, model_name: id })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-temp">Temperature (0–2)</Label>
                <Input id="llm-temp" type="number" step="0.1" min="0" max="2" value={editing.temperature} onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-tokens">Max tokens</Label>
                <Input id="llm-tokens" type="number" min="1" max="64000" value={editing.max_tokens} onChange={(e) => setEditing({ ...editing, max_tokens: Number(e.target.value) })} />
              </div>
              <label className="flex flex-row items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} className="size-4 accent-primary" />
                Active
              </label>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label>Base system prompt</Label>
              <TextareaZoom label="Base system prompt" rows={4} value={editing.system_prompt} onChange={(v) => setEditing({ ...editing, system_prompt: v })} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={save}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
