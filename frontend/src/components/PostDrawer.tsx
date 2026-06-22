import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Copy, Download, ExternalLink, Clock, CheckCircle2, XCircle, Send, Package } from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob, downloadFile } from "../api";
import { getBlobUrl } from "../lib/blobCache";
import type { CalendarItem } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useConfirm } from "@/components/ui/dialogs";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "outline",
  publishing: "outline",
  published: "default",
  partial: "destructive",
  failed: "destructive",
};

const APPROVAL_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_review: "outline",
  approved: "default",
  rejected: "destructive",
};

interface PostDrawerProps {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canReview: boolean;
  onRefresh: () => void;
}

export function PostDrawer({ item, open, onOpenChange, canEdit, canReview, onRefresh }: PostDrawerProps) {
  const confirm = useConfirm();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [showMarkPublished, setShowMarkPublished] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    setLoading(true);
    api<any>(`/campaigns/${item.campaign_id}/posts/${item.post_id}`)
      .then((p) => setPost(p))
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
    setRescheduleDate(item.scheduled_at ? new Date(item.scheduled_at) : null);
    setShowReschedule(false);
    setPublishedUrl(item.published_url || "");
    setShowMarkPublished(false);
  }, [item, open]);

  if (!item) return null;

  async function copyCaption() {
    if (!post) return;
    const text = [post.copy, post.hashtags?.join(" ")].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast.success("Caption copied to clipboard");
  }

  async function downloadMedia() {
    if (!item) return;
    toast.info("Preparing media download…");
    try {
      await downloadFile(
        `/campaigns/${item.campaign_id}/images/${item.post_id}/composite`,
        `post-${item.platform}-${item.id}.png`,
      );
    } catch {
      toast.error("Could not download media");
    }
  }

  async function exportPack() {
    if (!item) return;
    toast.info("Preparing export pack…");
    try {
      await downloadFile(
        `/scheduled-posts/${item.id}/export-pack`,
        `post-${item.platform}-${item.id.slice(0, 8)}-export.zip`,
      );
      toast.success("Export pack downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function submitForReview() {
    if (!item) return;
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/submit`, { method: "POST" });
      toast.success("Submitted for review");
      onRefresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    }
  }

  async function approvePost() {
    if (!item) return;
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/approve`, { method: "POST" });
      toast.success("Post approved");
      onRefresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve");
    }
  }

  async function rejectPost() {
    if (!item) return;
    const note = await confirm({
      title: "Reject post",
      description: "Add an optional note for the editor.",
      confirmLabel: "Reject",
      destructive: true,
    });
    if (!note) return;
    try {
      await api(`/campaigns/${item.campaign_id}/posts/${item.post_id}/reject`, {
        method: "POST",
        body: { note: "" },
      });
      toast.success("Post rejected");
      onRefresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject");
    }
  }

  async function doReschedule() {
    if (!item || !rescheduleDate) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      await api(`/scheduled-posts/${item.id}`, {
        method: "PATCH",
        body: { scheduled_at: rescheduleDate.toISOString(), timezone: tz },
      });
      toast.success("Post rescheduled");
      onRefresh();
      setShowReschedule(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reschedule failed");
    }
  }

  async function cancelScheduled() {
    if (!item) return;
    const ok = await confirm({
      title: "Cancel scheduled post",
      description: "The post won't be published at its scheduled time.",
      confirmLabel: "Cancel post",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/scheduled-posts/${item.id}`, { method: "DELETE" });
      toast.success("Scheduled post cancelled");
      onRefresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function markPublished() {
    if (!item || !publishedUrl) return;
    toast.info("Mark as published is not yet available via this UI — use the campaign page.");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <PlatformIcon platform={item.platform} size={20} />
            <SheetTitle className="text-base">
              {item.channel_name || platformLabel(item.platform)}
            </SheetTitle>
          </div>
          <SheetDescription>
            {item.client_name} · {item.campaign_name}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 flex flex-wrap gap-2">
          <Badge variant={STATUS_VARIANT[item.status] ?? "default"}>
            {item.status}
          </Badge>
          {item.approval_status && (
            <Badge variant={APPROVAL_VARIANT[item.approval_status] ?? "default"}>
              {item.approval_status.replace("_", " ")}
            </Badge>
          )}
        </div>

        <Separator />

        {/* Content preview */}
        <div className="px-4 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading post…</p>
          ) : post ? (
            <>
              {post.headline && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Headline</p>
                  <p className="font-medium">{post.headline}</p>
                </div>
              )}
              {post.copy && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Caption</p>
                  <p className="text-sm whitespace-pre-wrap">{post.copy}</p>
                </div>
              )}
              {post.hashtags?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Hashtags</p>
                  <p className="text-sm text-blue-600">{post.hashtags.join(" ")}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load post details.</p>
          )}
        </div>

        <Separator />

        {/* Quick actions */}
        <div className="px-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyCaption} disabled={!post}>
            <Copy size={14} /> Copy caption
          </Button>
          <Button variant="outline" size="sm" onClick={downloadMedia}>
            <Download size={14} /> Download media
          </Button>
          <Button variant="outline" size="sm" onClick={exportPack}>
            <Package size={14} /> Export pack
          </Button>
          {item.published_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={item.published_url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> View live post
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to={`/campaigns/${item.campaign_id}`}>
              <ExternalLink size={14} /> Open campaign
            </Link>
          </Button>
        </div>

        {/* Schedule info */}
        {item.scheduled_at && (
          <div className="px-4 text-sm text-muted-foreground flex items-center gap-2">
            <Clock size={14} />
            Scheduled for {new Date(item.scheduled_at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })} ({item.timezone})
          </div>
        )}

        {/* Reschedule */}
        {canEdit && item.status === "scheduled" && (
          <div className="px-4 space-y-2">
            {!showReschedule ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowReschedule(true)}>
                  <Clock size={14} /> Reschedule
                </Button>
                <Button variant="outline" size="sm" onClick={cancelScheduled}>
                  <XCircle size={14} /> Cancel schedule
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <DateTimePicker value={rescheduleDate} onChange={setRescheduleDate} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={doReschedule} disabled={!rescheduleDate}>
                    Confirm reschedule
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowReschedule(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approval actions */}
        {canReview && post && (
          <div className="px-4 space-y-2">
            <Separator />
            <p className="text-xs font-medium text-muted-foreground">Approval</p>
            <div className="flex flex-wrap gap-2">
              {item.approval_status === "draft" && canEdit && (
                <Button size="sm" onClick={submitForReview}>
                  <Send size={14} /> Submit for review
                </Button>
              )}
              {item.approval_status === "pending_review" && canReview && (
                <>
                  <Button size="sm" onClick={approvePost}>
                    <CheckCircle2 size={14} /> Approve
                  </Button>
                  <Button variant="outline" size="sm" onClick={rejectPost}>
                    <XCircle size={14} /> Reject
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {item.error && (
          <div className="px-4">
            <div className="alert alert-error small">{item.error}</div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
