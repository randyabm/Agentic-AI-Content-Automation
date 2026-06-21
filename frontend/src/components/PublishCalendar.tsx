import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, RefreshCw } from "lucide-react";
import { api } from "../api";
import type { CalendarItem, Client } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { useConfirm, usePrompt } from "@/components/ui/dialogs";

const STATUS_TAG: Record<string, string> = {
  scheduled: "tag-amber",
  publishing: "tag-amber",
  published: "tag-green",
  partial: "tag-amber",
  failed: "tag-red",
  draft: "",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  publishing: "Publishing…",
  published: "Published",
  partial: "Partial",
  failed: "Failed",
  draft: "Draft",
};

function dayKey(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PublishCalendar({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setItems(await api<CalendarItem[]>(`/clients/${client.id}/calendar`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [client.id]);

  async function reschedule(item: CalendarItem) {
    const current = item.scheduled_at ? new Date(item.scheduled_at) : new Date();
    const input = await promptDialog({
      title: "Reschedule post",
      description: "New date & time (YYYY-MM-DD HH:MM, local time).",
      defaultValue: current.toLocaleString("sv").slice(0, 16),
      placeholder: "YYYY-MM-DD HH:MM",
      confirmLabel: "Reschedule",
      allowEmpty: false,
    });
    if (!input) return;
    const when = new Date(input.replace(" ", "T"));
    if (isNaN(when.getTime())) {
      setError("Couldn't read that date — use YYYY-MM-DD HH:MM.");
      return;
    }
    setBusy(item.id);
    setError("");
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      await api(`/scheduled-posts/${item.id}`, {
        method: "PATCH",
        body: { scheduled_at: when.toISOString(), timezone: tz },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reschedule failed");
    } finally {
      setBusy("");
    }
  }

  async function cancel(item: CalendarItem) {
    const ok = await confirm({
      title: "Cancel scheduled post",
      description: "The post won't be published at its scheduled time.",
      confirmLabel: "Cancel post",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (!ok) return;
    setBusy(item.id);
    setError("");
    try {
      await api(`/scheduled-posts/${item.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy("");
    }
  }

  // Group by calendar day for a simple agenda view.
  const groups: { day: string; rows: CalendarItem[] }[] = [];
  for (const item of items) {
    const day = dayKey(item.scheduled_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(item);
    else groups.push({ day, rows: [item] });
  }

  return (
    <div className="channels">
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>
            <CalendarDays size={18} style={{ verticalAlign: "-3px" }} /> Publishing calendar
          </h2>
          <p className="muted">
            Scheduled and published posts for this client. Scheduled posts are sent automatically at their time.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={!!busy}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="card">
          <p className="muted">Loading…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="muted">
            Nothing scheduled yet. Approve a post in a campaign and use <em>Schedule…</em> to plan it here.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.day} className="card">
            <strong className="small">{g.day}</strong>
            <table className="table">
              <tbody>
                {g.rows.map((item) => (
                  <tr key={item.id}>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {item.scheduled_at
                        ? new Date(item.scheduled_at).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <PlatformIcon platform={item.platform} size={16} />
                        <span>
                          <strong>{item.channel_name || platformLabel(item.platform)}</strong>
                          <span className="muted small"> · {item.preview || item.headline || "(no copy)"}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <Link to={`/campaigns/${item.campaign_id}`} className="small">
                        {item.campaign_name}
                      </Link>
                    </td>
                    <td>
                      <span className={`tag ${STATUS_TAG[item.status] ?? ""}`}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                      {item.error && <span className="muted small"> — {item.error}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {item.published_url && (
                        <a href={item.published_url} target="_blank" rel="noreferrer" className="small">
                          View ↗
                        </a>
                      )}
                      {canEdit && item.status === "scheduled" && (
                        <>
                          <button className="btn btn-ghost" disabled={!!busy} onClick={() => reschedule(item)}>
                            Reschedule
                          </button>
                          <button className="btn btn-ghost" disabled={!!busy} onClick={() => cancel(item)}>
                            Cancel
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
