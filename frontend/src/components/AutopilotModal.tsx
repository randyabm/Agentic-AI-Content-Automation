import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { api } from "../api";
import type { AutopilotPreview } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";

/** Convert an ISO instant to a `datetime-local` value (local wall-clock). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function AutopilotModal({
  campaignId,
  onClose,
  onDone,
}: {
  campaignId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [preview, setPreview] = useState<AutopilotPreview | null>(null);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function loadPreview() {
    setBusy("Proposing the best times…");
    setError("");
    try {
      const p = await api<AutopilotPreview>(`/campaigns/${campaignId}/autopilot/preview`, {
        method: "POST",
        body: { timezone: tz, per_day: 2 },
      });
      setPreview(p);
      const t: Record<string, string> = {};
      for (const prop of p.proposals) t[prop.post_id] = toLocalInput(prop.suggested_at);
      setTimes(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function commit() {
    if (!preview || preview.proposals.length === 0) return;
    setBusy("Scheduling…");
    setError("");
    try {
      const items = preview.proposals.map((p) => ({
        post_id: p.post_id,
        scheduled_at: new Date(times[p.post_id]).toISOString(),
      }));
      const created = await api<unknown[]>(`/campaigns/${campaignId}/autopilot/commit`, {
        method: "POST",
        body: { timezone: tz, items },
      });
      setDone(`Scheduled ${created.length} post${created.length === 1 ? "" : "s"}. They'll publish automatically.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scheduling failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Sparkles size={18} style={{ verticalAlign: "-3px" }} /> AI auto-schedule
          </h2>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="muted small">
          The AI proposes an optimal time for each approved post ({tz}). Adjust any time, then confirm —
          posts publish automatically at their slot.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {done && <div className="alert alert-success">{done}</div>}

        {busy && !preview && <p className="muted">{busy}</p>}

        {preview && !done && (
          <>
            {preview.proposals.length === 0 ? (
              <p className="muted">No approved posts with a connected channel to schedule yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Post</th>
                    <th>When</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.proposals.map((p) => (
                    <tr key={p.post_id}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlatformIcon platform={p.platform} size={14} />
                          <span>
                            <strong>{p.channel_name || platformLabel(p.platform)}</strong>
                            <span className="muted small"> · {p.preview || p.headline || "(no copy)"}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <input
                          type="datetime-local"
                          value={times[p.post_id] ?? ""}
                          onChange={(e) => setTimes((prev) => ({ ...prev, [p.post_id]: e.target.value }))}
                        />
                      </td>
                      <td className="muted small">{p.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.skipped.length > 0 && (
              <div className="card" style={{ marginTop: 8 }}>
                <strong className="small">Skipped</strong>
                <ul className="muted small" style={{ margin: "0.25rem 0 0", paddingLeft: "1.2rem" }}>
                  {preview.skipped.map((s) => (
                    <li key={s.post_id}>
                      {platformLabel(s.platform)} — {s.headline || "post"}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                onClick={commit}
                disabled={!!busy || preview.proposals.length === 0}
              >
                {busy === "Scheduling…" ? "Scheduling…" : `Schedule ${preview.proposals.length} post(s)`}
              </button>
              <button className="btn btn-ghost" onClick={loadPreview} disabled={!!busy}>
                Re-propose
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="form-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
