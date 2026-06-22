import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
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
      <div className="page-header">
        <div>
          <h1>
            <CheckCircle2 size={20} style={{ verticalAlign: "-4px" }} /> Review Queue
          </h1>
          <p className="muted">Posts and campaigns awaiting your approval.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["all", "post", "campaign"] as const).map((t) => (
          <button
            key={t}
            className={`px-4 py-2 rounded-lg text-label-md font-bold transition-colors ${
              tab === t ? "bg-[#6d28d9] text-white" : "bg-[#f3f4f6] text-[#4a4455] hover:bg-[#e5e7eb]"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "all" ? "All" : t === "post" ? "Posts" : "Campaigns"}
            {t === "all" && ` (${items.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="card"><p className="muted">Nothing to review right now. 🎉</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <div
              key={item.review_type === "campaign" ? item.campaign_id : item.post_id}
              className="card p-md"
              style={{ borderRadius: "12px" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {item.review_type === "campaign" ? (
                      <span className="px-2 py-0.5 bg-[#ebddff] text-[#5300b7] text-[10px] font-bold uppercase rounded">Campaign</span>
                    ) : (
                      <PlatformIcon platform={item.platform} size={16} />
                    )}
                    <Link to={`/campaigns/${item.campaign_id}`} className="font-bold" style={{ fontSize: "0.9rem", color: "#6d28d9" }}>
                      {item.campaign_name}
                    </Link>
                    <span className="text-label-sm text-[#4a4455]">· {item.client_name}</span>
                  </div>
                  {item.review_type === "post" && (
                    <>
                      <p className="font-semibold" style={{ fontSize: "0.85rem" }}>{item.headline || platformLabel(item.platform)}</p>
                      <p className="text-label-sm text-[#4a4455]">{item.preview}</p>
                    </>
                  )}
                  {item.review_type === "campaign" && (
                    <p className="text-label-sm text-[#4a4455]">
                      {item.platform && <><strong>Platforms:</strong> {item.platform} · </>}
                      {item.approval_message && <><strong>Note:</strong> {item.approval_message}</>}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => item.review_type === "campaign" ? decideCampaign(item, "approve") : decidePost(item, "approve")}
                    disabled={!!busy}
                    style={{ background: "#10B981" }}
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
