import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BrandMemory as BrandMemoryT, Client } from "../types";
import { TextareaZoom } from "./TextareaZoom";

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

  const isEmpty =
    !form.brand_tone &&
    !form.brand_visual_style &&
    !form.brand_colors?.length &&
    !form.brand_words_required?.length;

  return (
    <>
      {/* Compact summary card */}
      <div className="card brand-summary-card">
        <div className="card-header-row" style={{ marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Brand Memory</h2>
          {canEdit && (
            <button className="btn btn-ghost" style={{ fontSize: "0.8rem", padding: "0.2rem 0.65rem" }} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>

        {isEmpty ? (
          <p className="muted small">No brand memory configured yet.</p>
        ) : (
          <div className="brand-summary-body">
            {form.brand_colors?.length > 0 && (
              <div className="brand-summary-colors">
                {form.brand_colors.slice(0, 8).map((c, i) => (
                  <span key={i} className="brand-summary-dot" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ccc" }} title={c} />
                ))}
              </div>
            )}
            {form.brand_tone && (
              <div className="brand-summary-row">
                <span className="brand-summary-label">Tone</span>
                <span className="brand-summary-value">
                  {form.brand_tone.length > 90 ? form.brand_tone.slice(0, 90) + "…" : form.brand_tone}
                </span>
              </div>
            )}
            {form.brand_visual_style && (
              <div className="brand-summary-row">
                <span className="brand-summary-label">Visual</span>
                <span className="brand-summary-value">{form.brand_visual_style}</span>
              </div>
            )}
            {form.brand_words_required?.length > 0 && (
              <div className="brand-summary-row">
                <span className="brand-summary-label brand-use">✓ Use</span>
                <span className="brand-summary-value brand-words-use">
                  {form.brand_words_required.slice(0, 5).join(", ")}
                  {form.brand_words_required.length > 5 && ` +${form.brand_words_required.length - 5}`}
                </span>
              </div>
            )}
            {form.brand_words_forbidden?.length > 0 && (
              <div className="brand-summary-row">
                <span className="brand-summary-label brand-avoid">✗ Avoid</span>
                <span className="brand-summary-value brand-words-avoid">
                  {form.brand_words_forbidden.slice(0, 5).join(", ")}
                  {form.brand_words_forbidden.length > 5 && ` +${form.brand_words_forbidden.length - 5}`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(false); }}
        >
          <div className="modal brand-memory-modal">
            <div className="modal-header">
              <h2>Brand Memory</h2>
              <button type="button" className="btn-icon" onClick={() => setEditing(false)} aria-label="Close">✕</button>
            </div>
            <p className="muted small" style={{ margin: "0 0 1rem" }}>
              Persistent context injected into every campaign prompt. Saved with version history.
            </p>

            {notice && <div className="alert alert-success">{notice}</div>}
            {error && <div className="alert alert-error">{error}</div>}

            <div className="brand-memory-modal-body">
              <label>
                Brand tone &amp; voice
                <TextareaZoom
                  label="Brand tone & voice"
                  rows={2}
                  value={form.brand_tone}
                  onChange={(v) => setForm({ ...form, brand_tone: v })}
                  placeholder="e.g. professional, approachable, innovative"
                />
              </label>
              <label>
                Preferred visual style
                <TextareaZoom
                  label="Preferred visual style"
                  rows={1}
                  value={form.brand_visual_style}
                  onChange={(v) => setForm({ ...form, brand_visual_style: v })}
                  placeholder="e.g. minimalist, vibrant, corporate, lifestyle"
                />
              </label>
              <div className="form-grid">
                <label>
                  Words/phrases to always use (one per line)
                  <TextareaZoom
                    label="Words/phrases to always use"
                    rows={4}
                    value={lines(form.brand_words_required)}
                    onChange={(v) => setForm({ ...form, brand_words_required: toLines(v) })}
                  />
                </label>
                <label>
                  Words/phrases to never use (one per line)
                  <TextareaZoom
                    label="Words/phrases to never use"
                    rows={4}
                    value={lines(form.brand_words_forbidden)}
                    onChange={(v) => setForm({ ...form, brand_words_forbidden: toLines(v) })}
                  />
                </label>
              </div>

              <div className="field-label">Corporate colors</div>
              <div className="color-picker-box">
                <div className="color-picker-grid">
                  {form.brand_colors.map((c, i) => (
                    <div key={i} className="color-picker-row">
                      <input
                        type="color"
                        ref={(el) => { colorRefs.current[i] = el; }}
                        value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000"}
                        onChange={(e) => setColor(i, e.target.value)}
                      />
                      <input
                        className="color-hex-input"
                        value={c}
                        placeholder="#1A2B3C"
                        onChange={(e) => setColor(i, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost color-remove"
                        title="Remove color"
                        onClick={() => setForm({ ...form, brand_colors: form.brand_colors.filter((_, j) => j !== i) })}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-ghost color-add-btn" onClick={addColor}>
                  + Add color
                </button>
              </div>

              <label>
                Approved copy examples (one per line)
                <TextareaZoom
                  label="Approved copy examples"
                  rows={4}
                  value={lines(form.brand_copy_examples)}
                  onChange={(v) => setForm({ ...form, brand_copy_examples: toLines(v) })}
                />
              </label>
              <label>
                Legal / recurring disclaimer text
                <TextareaZoom
                  label="Legal / recurring disclaimer text"
                  rows={2}
                  value={form.brand_legal_disclaimer}
                  onChange={(v) => setForm({ ...form, brand_legal_disclaimer: v })}
                  placeholder="e.g. Terms and conditions apply."
                />
              </label>
            </div>

            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", marginTop: "0.5rem" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save}>Save Brand Memory</button>
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
