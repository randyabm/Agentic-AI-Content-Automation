import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { PageHeader } from "@/components/ui/page-header";
import type { ReviewQueueItem } from "../types";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { usePrompt } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"all" | "post" | "campaign">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const promptDialog = usePrompt();

  function toggleSelected(postId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  }

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
    // Live updates (FR-11): keep the queue current as others submit/act.
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 25000);
    return () => clearInterval(id);
  }, []);

  const filtered = items.filter((i) => tab === "all" || i.review_type === tab);

  type ReviewAction = "approve" | "reject" | "request-changes";

  async function decideCampaign(item: ReviewQueueItem, action: ReviewAction) {
    let note = "";
    if (action !== "approve") {
      const reject = action === "reject";
      const reason = await promptDialog({
        title: reject ? "Reject campaign" : "Request changes",
        description: reject
          ? "Explain what needs to change (the team will see it)."
          : "Tell the editor what to revise — the campaign goes back to them to fix and resubmit.",
        placeholder: reject ? "Reason for rejection (required)" : "What needs to change? (required)",
        confirmLabel: reject ? "Reject" : "Request changes",
        destructive: reject,
        allowEmpty: false,
      });
      if (reason === null || !reason.trim()) return;
      note = reason;
    }
    setBusy(item.campaign_id);
    setError("");
    try {
      await api(`/campaigns/${item.campaign_id}/${action}`, {
        method: "POST",
        body: { note },
      });
      toast.success(
        action === "approve" ? "Campaign approved" : action === "reject" ? "Campaign rejected" : "Changes requested",
      );
      setItems((prev) => prev.filter((i) => i.campaign_id !== item.campaign_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function decidePost(item: ReviewQueueItem, action: ReviewAction) {
    let note = "";
    if (action !== "approve") {
      const reject = action === "reject";
      const reason = await promptDialog({
        title: reject ? "Reject post" : "Request changes",
        description: reject
          ? "Explain what needs to change (the author will see it)."
          : "Tell the author what to revise — the post goes back to them to fix and resubmit.",
        placeholder: reject ? "Reason for rejection (required)" : "What needs to change? (required)",
        confirmLabel: reject ? "Reject" : "Request changes",
        destructive: reject,
        allowEmpty: false,
      });
      if (reason === null || !reason.trim()) return;
      note = reason;
    }
    setBusy(item.post_id);
    setError("");
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/${action}`, {
        method: "POST",
        body: action === "approve" ? {} : { note },
      });
      toast.success(
        action === "approve" ? "Post approved" : action === "reject" ? "Post rejected" : "Changes requested",
      );
      setItems((prev) => prev.filter((i) => i.post_id !== item.post_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function bulkDecide(action: "approve" | "reject") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let note = "";
    if (action === "reject") {
      const reason = await promptDialog({
        title: `Reject ${ids.length} post${ids.length === 1 ? "" : "s"}`,
        description: "This comment is sent to every selected post's author.",
        placeholder: "Reason for rejection (required)",
        confirmLabel: "Reject selected",
        destructive: true,
        allowEmpty: false,
      });
      if (reason === null || !reason.trim()) return;
      note = reason;
    }
    setBusy("bulk");
    setError("");
    try {
      const res = await api<{ acted: number; failed: number }>(
        `/campaigns/posts/bulk-${action}`,
        { method: "POST", body: { post_ids: ids, note } },
      );
      toast.success(`${res.acted} ${action === "approve" ? "approved" : "rejected"}${res.failed ? `, ${res.failed} skipped` : ""}`);
      setItems((prev) => prev.filter((i) => !(i.review_type === "post" && selected.has(i.post_id))));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk action failed");
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 size={20} /> Review Queue</span>}
        description="Posts and campaigns awaiting your approval."
      />

      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {(["all", "post", "campaign"] as const).map((t) => (
          <button
            key={t}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "all" ? "All" : t === "post" ? "Posts" : "Campaigns"}
            {t === "all" && ` (${items.length})`}
          </button>
        ))}
      </div>

      {(() => {
        const postItems = filtered.filter((i) => i.review_type === "post");
        if (postItems.length === 0) return null;
        const allSelected = postItems.every((i) => selected.has(i.post_id));
        return (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(postItems.map((i) => i.post_id)))
                }
              />
              Select all posts
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-muted-foreground">{selected.size} selected</span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={busy === "bulk"} onClick={() => bulkDecide("approve")}>
                    Approve selected
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive"
                    disabled={busy === "bulk"} onClick={() => bulkDecide("reject")}>
                    Reject selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Nothing to review right now. 🎉</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <div
              key={item.review_type === "campaign" ? item.campaign_id : item.post_id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                {item.review_type === "post" && (
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    checked={selected.has(item.post_id)}
                    onChange={() => toggleSelected(item.post_id)}
                  />
                )}
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    {item.review_type === "campaign" ? (
                      <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-accent-foreground">Campaign</span>
                    ) : (
                      <PlatformIcon platform={item.platform} size={16} />
                    )}
                    <Link to={`/campaigns/${item.campaign_id}`} className="text-sm font-bold text-primary hover:underline">
                      {item.campaign_name}
                    </Link>
                    <span className="text-xs text-muted-foreground">· {item.client_name}</span>
                    <DueBadge due={item.approval_due_date} />
                  </div>
                  {item.review_type === "post" && (
                    <>
                      <p className="text-sm font-semibold">{item.headline || platformLabel(item.platform)}</p>
                      <p className="text-xs text-muted-foreground">{item.preview}</p>
                    </>
                  )}
                  {item.review_type === "campaign" && (
                    <p className="text-xs text-muted-foreground">
                      {item.platform && <><strong>Platforms:</strong> {item.platform} · </>}
                      {item.approval_message && <><strong>Note:</strong> {item.approval_message}</>}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => item.review_type === "campaign" ? decideCampaign(item, "approve") : decidePost(item, "approve")}
                    disabled={!!busy}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => item.review_type === "campaign" ? decideCampaign(item, "request-changes") : decidePost(item, "request-changes")}
                    disabled={!!busy}
                    title="Send back to the editor to revise and resubmit"
                  >
                    Request changes
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => item.review_type === "campaign" ? decideCampaign(item, "reject") : decidePost(item, "reject")}
                    disabled={!!busy}
                    className="text-destructive"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Approval due-date chip; turns red once the deadline has passed (Phase 2). */
function DueBadge({ due }: { due: string | null }) {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = d < today;
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <span
      className={
        overdue
          ? "rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300"
          : "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
      }
      title={overdue ? "Approval overdue" : "Approval due"}
    >
      {overdue ? `Overdue · ${label}` : `Due ${label}`}
    </span>
  );
}
