import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api } from "../api";
import type { ReviewQueueItem } from "../types";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setItems(await api<ReviewQueueItem[]>("/review-queue"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(item: ReviewQueueItem, action: "approve" | "reject") {
    let note = "";
    if (action === "reject") note = window.prompt("Reason for rejection (optional):") ?? "";
    setBusy(item.post_id);
    setError("");
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/${action}`, {
        method: "POST",
        body: action === "reject" ? { note } : {},
      });
      setItems((prev) => prev.filter((i) => i.post_id !== item.post_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            <CheckCircle2 size={20} style={{ verticalAlign: "-4px" }} /> Review Queue
          </h1>
          <p className="muted">Posts awaiting your approval before they can be published or scheduled.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="card">
          <p className="muted">Loading…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing to review right now. 🎉</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Campaign</th>
                <th>Client</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.post_id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <PlatformIcon platform={item.platform} size={16} />
                      <span>
                        <strong>{item.headline || platformLabel(item.platform)}</strong>
                        <span className="muted small"> · {item.preview || "(no copy)"}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Link to={`/campaigns/${item.campaign_id}`} className="small">
                      {item.campaign_name}
                    </Link>
                  </td>
                  <td className="muted small">{item.client_name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => decide(item, "approve")}>
                      Approve
                    </button>
                    <button className="btn btn-ghost" disabled={!!busy} onClick={() => decide(item, "reject")}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
