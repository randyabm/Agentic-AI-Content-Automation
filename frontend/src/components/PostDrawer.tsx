import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Copy, Download, ExternalLink, Clock, CheckCircle2, XCircle, Send, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile } from "../api";
import type { CalendarItem, Post } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useConfirm } from "@/components/ui/dialogs";
import { cn } from "@/lib/utils";

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
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    setLoading(true);
    api<Post>(`/campaigns/${item.campaign_id}/posts/${item.post_id}`)
      .then((p) => setPost(p))
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
    setRescheduleDate(item.scheduled_at ? new Date(item.scheduled_at) : null);
    setShowReschedule(false);
  }, [item, open]);

  if (!item) return null;

  async function copyCaption() {
    if (!post) return;
    const text = [post.headline, post.copy, post.hashtags?.join(" ")].filter(Boolean).join("\n\n");
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
    const ok = await confirm({
      title: "Reject post",
      description: "Are you sure you want to reject this post?",
      confirmLabel: "Reject",
      destructive: true,
    });
    if (!ok) return;
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
    setBusy(true);
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
    } finally {
      setBusy(false);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <PlatformIcon platform={item.platform} size={16} />
            </div>
            <div className="flex-1">
              <SheetTitle className="text-base">
                {item.channel_name || platformLabel(item.platform)}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {item.client_name} · {item.campaign_name}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant={STATUS_VARIANT[item.status] ?? "default"} className="capitalize">
              {item.status}
            </Badge>
            {item.approval_status && (
              <Badge variant={APPROVAL_VARIANT[item.approval_status] ?? "default"} className="capitalize">
                {item.approval_status.replace("_", " ")}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 h-[calc(100vh-140px)]">
          <div className="px-6 py-4 space-y-5">
            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <RefreshCw size={16} className="animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading post…</span>
              </div>
            ) : post ? (
              <div className="space-y-4">
                {post.headline && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Headline</p>
                    <p className="text-sm font-medium">{post.headline}</p>
                  </div>
                )}
                {post.copy && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Caption</p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.copy}</p>
                  </div>
                )}
                {post.hashtags && post.hashtags.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Hashtags</p>
                    <p className="text-sm text-primary">{post.hashtags.join(" ")}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Could not load post details.</p>
            )}

            <Separator />

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={copyCaption} disabled={!post} className="justify-start">
                <Copy size={14} /> Copy caption
              </Button>
              <Button variant="outline" size="sm" onClick={downloadMedia} className="justify-start">
                <Download size={14} /> Download media
              </Button>
              <Button variant="outline" size="sm" onClick={exportPack} className="justify-start">
                <Package size={14} /> Export pack
              </Button>
              {item.published_url && (
                <Button variant="outline" size="sm" asChild className="justify-start">
                  <a href={item.published_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> View live post
                  </a>
                </Button>
              )}
            </div>

            <Button variant="ghost" size="sm" asChild className="w-full">
              <Link to={`/campaigns/${item.campaign_id}`}>
                <ExternalLink size={14} /> Open campaign
              </Link>
            </Button>

            {/* Schedule info */}
            {item.scheduled_at && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Clock size={14} />
                {new Date(item.scheduled_at).toLocaleString(undefined, {
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
              <div className="space-y-2">
                {!showReschedule ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowReschedule(true)} className="flex-1">
                      <Clock size={14} /> Reschedule
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelScheduled} className="text-destructive hover:text-destructive">
                      <XCircle size={14} /> Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/20">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reschedule</p>
                    <DateTimePicker value={rescheduleDate} onChange={setRescheduleDate} className="w-full" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={doReschedule} disabled={!rescheduleDate || busy}>
                        {busy ? "Saving…" : "Confirm"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowReschedule(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Approval */}
            {post && (canEdit || canReview) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Approval</p>
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
                        <Button variant="outline" size="sm" onClick={rejectPost} className="text-destructive hover:text-destructive">
                          <XCircle size={14} /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Error */}
            {item.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {item.error}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
