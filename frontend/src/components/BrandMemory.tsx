import { useEffect, useState } from "react";
import { api } from "../api";
import type { BrandMemory as BrandMemoryT, Client } from "../types";

export function BrandMemory({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const [form, setForm] = useState<BrandMemoryT>({
    brand_tone: client.brand_tone,
    brand_words_required: client.brand_words_required,
    brand_words_forbidden: client.brand_words_forbidden,
    brand_colors: client.brand_colors,
    brand_visual_style: client.brand_visual_style,
    brand_copy_examples: client.brand_copy_examples,
    brand_legal_disclaimer: client.brand_legal_disclaimer,
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({
      brand_tone: client.brand_tone,
      brand_words_required: client.brand_words_required,
      brand_words_forbidden: client.brand_words_forbidden,
      brand_colors: client.brand_colors,
      brand_visual_style: client.brand_visual_style,
      brand_copy_examples: client.brand_copy_examples,
      brand_legal_disclaimer: client.brand_legal_disclaimer,
    });
  }, [client]);

  async function save() {
    setError("");
    setNotice("");
    try {
      await api(`/clients/${client.id}/brand-memory`, { method: "PUT", body: form });
      setNotice("Brand Memory saved (a new version was recorded).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const lines = (v: string[]) => v.join("\n");
  const toLines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <div className="card">
      <h2>Brand Memory</h2>
      <p className="muted">
        Persistent context injected into every campaign prompt (PRD §5.3.3). Saved with version history.
      </p>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <label>
        Brand tone &amp; voice
        <textarea
          rows={2}
          value={form.brand_tone}
          onChange={(e) => setForm({ ...form, brand_tone: e.target.value })}
          readOnly={!canEdit}
          placeholder="e.g. professional, approachable, innovative"
        />
      </label>
      <label>
        Preferred visual style
        <input
          value={form.brand_visual_style}
          onChange={(e) => setForm({ ...form, brand_visual_style: e.target.value })}
          readOnly={!canEdit}
          placeholder="e.g. minimalist, vibrant, corporate, lifestyle"
        />
      </label>
      <div className="form-grid">
        <label>
          Words/phrases to always use (one per line)
          <textarea
            rows={4}
            value={lines(form.brand_words_required)}
            onChange={(e) => setForm({ ...form, brand_words_required: toLines(e.target.value) })}
            readOnly={!canEdit}
          />
        </label>
        <label>
          Words/phrases to never use (one per line)
          <textarea
            rows={4}
            value={lines(form.brand_words_forbidden)}
            onChange={(e) => setForm({ ...form, brand_words_forbidden: toLines(e.target.value) })}
            readOnly={!canEdit}
          />
        </label>
      </div>
      <label>
        Corporate colors (hex, one per line)
        <textarea
          rows={3}
          value={lines(form.brand_colors)}
          onChange={(e) => setForm({ ...form, brand_colors: toLines(e.target.value) })}
          readOnly={!canEdit}
          placeholder="#1A2B3C"
        />
      </label>
      {form.brand_colors.length > 0 && (
        <div className="color-swatches">
          {form.brand_colors.map((c, i) => (
            <span key={i} className="swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      )}
      <label>
        Approved copy examples (one per line)
        <textarea
          rows={4}
          value={lines(form.brand_copy_examples)}
          onChange={(e) => setForm({ ...form, brand_copy_examples: toLines(e.target.value) })}
          readOnly={!canEdit}
        />
      </label>
      <label>
        Legal / recurring disclaimer text
        <textarea
          rows={2}
          value={form.brand_legal_disclaimer}
          onChange={(e) => setForm({ ...form, brand_legal_disclaimer: e.target.value })}
          readOnly={!canEdit}
          placeholder="e.g. Terms and conditions apply."
        />
      </label>
      {canEdit && (
        <div className="form-actions">
          <button className="btn btn-primary" onClick={save}>
            Save Brand Memory
          </button>
        </div>
      )}
    </div>
  );
}
