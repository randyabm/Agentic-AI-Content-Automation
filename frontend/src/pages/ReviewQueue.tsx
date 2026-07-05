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
  const promptDialog = usePrompt();

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

  const filtered = items.filter((i) => tab === "all" || i.review_type === tab);

  async function decideCampaign(item: ReviewQueueItem, action: "approve" | "reject") {
    let note = "";
    if (action === "reject") {
      const reason = await promptDialog({
        title: "Reject campaign",
        description: "Add an optional note explaining why.",
        placeholder: "Reason for rejection (optional)",
        confirmLabel: "Reject",
        destructive: true,
      });
      if (reason === null) return;
      note = reason;
    }
    setBusy(item.campaign_id);
    setError("");
    try {
      await api(`/campaigns/${item.campaign_id}/${action}`, {
        method: "POST",
        body: { note },
      });
      toast.success(action === "approve" ? "Campaign approved" : "Campaign rejected");
      setItems((prev) => prev.filter((i) => i.campaign_id !== item.campaign_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function decidePost(item: ReviewQueueItem, action: "approve" | "reject") {
    let note = "";
    if (action === "reject") {
      const reason = await promptDialog({
        title: "Reject post",
        description: "Add an optional note explaining why (the author will see it).",
        placeholder: "Reason for rejection (optional)",
        confirmLabel: "Reject",
        destructive: true,
      });
      if (reason === null) return;
      note = reason;
    }
    setBusy(item.post_id);
    setError("");
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/${action}`, {
        method: "POST",
        body: action === "reject" ? { note } : {},
      });
      toast.success(action === "approve" ? "Post approved" : "Post rejected");
      setItems((prev) => prev.filter((i) => i.post_id !== item.post_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      toast.error(e instanceof Error ? e.message : "Action failed");
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
