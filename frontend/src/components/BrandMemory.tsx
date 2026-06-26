import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import type { BrandMemory as BrandMemoryT, Client } from "../types";
import { TextareaZoom } from "./TextareaZoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function BrandMemory({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BrandMemoryT>(fromClient(client));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const colorRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [pendingColorFocus, setPendingColorFocus] = useState<number | null>(null);

  useEffect(() => { setForm(fromClient(client)); }, [client]);

  useEffect(() => {
    if (pendingColorFocus !== null && colorRefs.current[pendingColorFocus]) {
      colorRefs.current[pendingColorFocus]?.click();
      setPendingColorFocus(null);
    }
  }, [pendingColorFocus]);

  async function save() {
    setError("");
    setNotice("");
    try {
      await api(`/clients/${client.id}/brand-memory`, { method: "PUT", body: form });
      setNotice("Saved.");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const lines = (v: string[]) => v.join("\n");
  const toLines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

  function setColor(i: number, value: string) {
    const next = [...form.brand_colors];
    next[i] = value.toUpperCase();
    setForm({ ...form, brand_colors: next });
  }

  function addColor() {
    const newIndex = form.brand_colors.length;
    setForm({ ...form, brand_colors: [...form.brand_colors, "#3E47C2"] });
    setPendingColorFocus(newIndex);
  }

  const isEmpty = !form.brand_tone && !form.brand_visual_style && !form.brand_colors?.length && !form.brand_words_required?.length;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Brand Memory</CardTitle>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">No brand memory configured yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {form.brand_colors?.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {form.brand_colors.slice(0, 8).map((c, i) => (
                    <span key={i} className="inline-block size-5 rounded-full border border-black/10 shadow-sm" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ccc" }} title={c} />
                  ))}
                </div>
              )}
              {form.brand_tone && (
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-xs text-muted-foreground">Tone</span>
                  <span className="text-sm">{form.brand_tone.length > 90 ? form.brand_tone.slice(0, 90) + "…" : form.brand_tone}</span>
                </div>
              )}
              {form.brand_visual_style && (
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-xs text-muted-foreground">Visual</span>
                  <span className="text-sm">{form.brand_visual_style}</span>
                </div>
              )}
              {form.brand_words_required?.length > 0 && (
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-xs font-semibold text-emerald-600">✓ Use</span>
                  <span className="text-sm text-emerald-700">
                    {form.brand_words_required.slice(0, 5).join(", ")}
                    {form.brand_words_required.length > 5 && ` +${form.brand_words_required.length - 5}`}
                  </span>
                </div>
              )}
              {form.brand_words_forbidden?.length > 0 && (
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-xs font-semibold text-red-600">✗ Avoid</span>
                  <span className="text-sm text-red-700">
                    {form.brand_words_forbidden.slice(0, 5).join(", ")}
                    {form.brand_words_forbidden.length > 5 && ` +${form.brand_words_forbidden.length - 5}`}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="flex max-h-[88vh] w-full max-w-[760px] flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6">
            <div className="mb-2 flex items-start justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold">Brand Memory</h2>
              <Button variant="ghost" size="icon" onClick={() => setEditing(false)} aria-label="Close"><X size={14} /></Button>
            </div>
            <p className="mb-2 text-sm text-muted-foreground">Persistent context injected into every campaign prompt. Saved with version history.</p>

            {notice && <div className="rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
            {error && <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div className="space-y-3">
              <label className="block text-sm">Brand tone & voice
                <TextareaZoom label="Brand tone & voice" rows={2} value={form.brand_tone}
                  onChange={(v) => setForm({ ...form, brand_tone: v })}
                  placeholder="e.g. professional, approachable, innovative" />
              </label>
              <label className="block text-sm">Preferred visual style
                <TextareaZoom label="Preferred visual style" rows={1} value={form.brand_visual_style}
                  onChange={(v) => setForm({ ...form, brand_visual_style: v })}
                  placeholder="e.g. minimalist, vibrant, corporate, lifestyle" />
              </label>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <label className="block text-sm">Words/phrases to always use (one per line)
                  <TextareaZoom label="Words/phrases to always use" rows={4} value={lines(form.brand_words_required)}
                    onChange={(v) => setForm({ ...form, brand_words_required: toLines(v) })} />
                </label>
                <label className="block text-sm">Words/phrases to never use (one per line)
                  <TextareaZoom label="Words/phrases to never use" rows={4} value={lines(form.brand_words_forbidden)}
                    onChange={(v) => setForm({ ...form, brand_words_forbidden: toLines(v) })} />
                </label>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Corporate colors</div>
                <div className="space-y-2 rounded-md border border-border bg-surface-alt p-3">
                  <div className="space-y-2">
                    {form.brand_colors.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="color" ref={(el) => { colorRefs.current[i] = el; }}
                          value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000"}
                          onChange={(e) => setColor(i, e.target.value)}
                          className="size-10 cursor-pointer rounded-md border border-border" />
                        <Input className="flex-1 font-mono" value={c} placeholder="#1A2B3C" onChange={(e) => setColor(i, e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" title="Remove color"
                          onClick={() => setForm({ ...form, brand_colors: form.brand_colors.filter((_, j) => j !== i) })}>
                          <X size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={addColor}>
                    <Plus size={14} /> Add color
                  </Button>
                </div>
              </div>

              <label className="block text-sm">Approved copy examples (one per line)
                <TextareaZoom label="Approved copy examples" rows={4} value={lines(form.brand_copy_examples)}
                  onChange={(v) => setForm({ ...form, brand_copy_examples: toLines(v) })} />
              </label>
              <label className="block text-sm">Legal / recurring disclaimer text
                <TextareaZoom label="Legal / recurring disclaimer text" rows={2} value={form.brand_legal_disclaimer}
                  onChange={(v) => setForm({ ...form, brand_legal_disclaimer: v })}
                  placeholder="e.g. Terms and conditions apply." />
              </label>
            </div>

            <div className="mt-2 flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={save}>Save Brand Memory</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function fromClient(client: Client): BrandMemoryT {
  return {
    brand_tone: client.brand_tone ?? "",
    brand_words_required: client.brand_words_required ?? [],
    brand_words_forbidden: client.brand_words_forbidden ?? [],
    brand_colors: client.brand_colors ?? [],
    brand_visual_style: client.brand_visual_style ?? "",
    brand_copy_examples: client.brand_copy_examples ?? [],
    brand_legal_disclaimer: client.brand_legal_disclaimer ?? "",
  };
}
