import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarDays, ChevronRight, Eye, FileImage, Film, Layers, Pencil, Rocket, Sparkles, Type } from "lucide-react";
import { api, downloadFile } from "../api";
import { AutopilotModal } from "../components/AutopilotModal";
import { CampaignSchedulerModal } from "../components/CampaignSchedulerModal";
import { TextareaZoom } from "../components/TextareaZoom";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { LivePreviewColumn, type PreviewDraft } from "../components/PostPreview";
import { AiAssist } from "../components/AiAssist";
import { ApprovedBanner } from "../components/ApprovedBanner";
import { EditWarningDialog } from "../components/EditWarningDialog";
import { ApprovalTimeline, type TimelineEvent } from "../components/ApprovalTimeline";
import { ApprovalBadge } from "../components/ApprovalBadge";
import BlockedReasonBadge from "../components/BlockedReasonBadge";
import { WorkflowStepper } from "../components/WorkflowStepper";
import { toast } from "sonner";
import { useConfirm, usePrompt } from "@/components/ui/dialogs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateTimePicker } from "@/components/ui/date-picker";
import { useAuth } from "../auth";
import { ElementVideoThumb, VideoVisual } from "./campaignDetail/VideoSlots";
import { ElementThumb, ElementVisual, PostThumbnail } from "./campaignDetail/ImageSlots";
import type {
  CampaignDetail as Campaign, CampaignApprovalStatus, CampaignElement, Client, ElementType,
  ImageModel, Post, PostImage, PostVideo, PublishState, User, VideoModel,
} from "../types";

const PLATFORM_LIMITS: Record<string, number> = {
  facebook: 63206, instagram: 2200, linkedin: 3000, tiktok: 2200, x: 280, youtube: 5000,
};

type PostType = ElementType;
const POST_TYPE_ORDER: PostType[] = ["image", "carousel", "video", "text"];
const POST_TYPE_META: Record<PostType, { label: string; singular: string; icon: string }> = {
  image: { label: "Images", singular: "Image", icon: "image" },
  carousel: { label: "Carousels", singular: "Carousel", icon: "view_carousel" },
  video: { label: "Videos", singular: "Video / Reel", icon: "movie" },
  text: { label: "Text", singular: "Text", icon: "article" },
};

function postType(post: Post, elements: CampaignElement[]): PostType {
  const el = elements.find((e) => e.id === post.element_id);
  return (el?.element_type as PostType) ?? "text";
}

const APPROVAL_LABELS: Record<string, string> = {
  draft: "Draft", pending_review: "Pending review", approved: "Approved", rejected: "Rejected",
};

const APPROVAL_STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary", pending_review: "warning", changes_requested: "warning",
  approved: "success", rejected: "destructive",
};

export default function CampaignDetail() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [openElementId, setOpenElementId] = useState<string | null>(null);
  const [showAutopilot, setShowAutopilot] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [postTypeTab, setPostTypeTab] = useState<string>("all");
  const [showEditWarning, setShowEditWarning] = useState(false);
  const [team, setTeam] = useState<User[]>([]);
  const [busyApproval, setBusyApproval] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const canEdit = user?.role === "admin" || user?.role === "editor";
  const canReview = user?.org_role === "reviewer" || user?.org_role === "org_admin" || user?.is_platform_admin;
  const canSubmit = user?.org_role === "analyst" || user?.org_role === "creative" || user?.org_role === "reviewer" || user?.org_role === "org_admin";

  const approvalStatus = campaign?.approval_status ?? ("draft" as CampaignApprovalStatus);

  async function load() {
    const c = await api<Campaign>(`/campaigns/${campaignId}`);
    setCampaign(c);
    if (!client) api<Client>(`/clients/${c.client_id}`).then(setClient).catch(() => {});
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ImageModel[]>("/image-models").then(setModels).catch(() => {});
    api<VideoModel[]>("/video-models").then(setVideoModels).catch(() => {});
    api<User[]>("/team").then(setTeam).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const mediaGenerating = campaign?.elements.some(
    (el) => el.videos.some((v) => v.status === "generating") || el.images.some((i) => i.status === "generating"),
  ) ?? false;

  useEffect(() => {
    if (campaign?.status !== "generating" && !mediaGenerating) return;
    // Poll the tiny status payload and refetch the full campaign only when
    // something actually changed (a slot finished, generation completed).
    let lastSnapshot = "";
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await api<unknown>(`/campaigns/${campaignId}/generation-status`);
        const snapshot = JSON.stringify(s);
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          await load();
        }
      } catch { /* transient poll errors are fine */ }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.status, mediaGenerating]);

  if (!campaign) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;

  const orphanPosts = campaign.posts.filter((p) => !p.element_id);
  const openElement = campaign.elements.find((el) => el.id === openElementId) ?? null;
  const openOrphan = openElementId?.startsWith("post:")
    ? orphanPosts.find((p) => p.id === openElementId.slice(5)) ?? null
    : null;

  async function regenerateAll() {
    setBusy("Regenerating…");
    try {
      await api(`/campaigns/${campaign!.id}/regenerate`, { method: "POST", body: {} });
      await load();
    } finally { setBusy(""); }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete campaign",
      description: "This permanently deletes the campaign and all its posts. This cannot be undone.",
      confirmLabel: "Delete", destructive: true,
    });
    if (!ok) return;
    await api(`/campaigns/${campaign!.id}`, { method: "DELETE" });
    toast.success("Campaign deleted");
    navigate("/campaigns");
  }

  async function handleApprove() {
    setBusyApproval("Approving…");
    try {
      await api(`/campaigns/${campaign!.id}/approve`, { method: "POST", body: { note: reviewNote } });
      toast.success("Campaign approved");
      setReviewNote("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Approval failed"); }
    finally { setBusyApproval(""); }
  }

  async function handleRequestChanges() {
    if (!reviewNote.trim()) { toast.error("Add feedback describing the changes needed."); return; }
    setBusyApproval("Requesting changes…");
    try {
      await api(`/campaigns/${campaign!.id}/request-changes`, { method: "POST", body: { note: reviewNote } });
      toast.success("Changes requested");
      setReviewNote("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusyApproval(""); }
  }

  async function handleReject() {
    setBusyApproval("Rejecting…");
    try {
      await api(`/campaigns/${campaign!.id}/reject`, { method: "POST", body: { note: reviewNote } });
      toast.success("Campaign rejected");
      setReviewNote("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusyApproval(""); }
  }

  async function handleCancelRequest() {
    const ok = await confirm({
      title: "Cancel approval request",
      description: "This will withdraw the approval request and return the campaign to draft.",
      confirmLabel: "Cancel Request", destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/campaigns/${campaign!.id}/submit-for-approval`, {
        method: "POST", body: { assigned_approver_id: "", approval_scope: "full_campaign", message: "" },
      });
      toast.success("Approval request cancelled");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  function approverName(id: string | null): string {
    if (!id) return "";
    const m = team.find((t) => t.id === id);
    return m ? m.full_name : id;
  }

  const isEditorMode = approvalStatus === "draft" || approvalStatus === "changes_requested";
  const isLocked = approvalStatus === "pending_review";
  const activePlatforms = campaign.platforms.filter((p) => p.is_active);
  const workflowStep: "draft" | "preview" | "approval" | "live" =
    approvalStatus === "pending_review" ? "approval" : approvalStatus === "approved" ? "live" : "draft";

  function buildTimeline(c: Campaign): TimelineEvent[] {
    const events: TimelineEvent[] = [
      { label: "Campaign created", description: "Initial draft", timestamp: new Date(c.created_at).toLocaleString(), icon: "check_circle", tone: "bg-primary" },
    ];
    if (c.approval_status !== "draft") {
      events.push({ label: "Submitted for approval", description: c.approval_message || "No message", timestamp: "", icon: "send", tone: "bg-primary" });
    }
    if (c.approval_status === "pending_review") {
      events.push({ label: "Pending review", description: `Waiting for ${approverName(c.assigned_approver_id)}`, timestamp: c.approval_due_date ? `Due ${new Date(c.approval_due_date).toLocaleDateString()}` : "", icon: "pending", tone: "bg-status-pending" });
    } else if (c.approval_status === "approved") {
      events.push({ label: `Approved${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`, description: c.review_note || "", timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "", icon: "verified", tone: "bg-emerald-500" });
    } else if (c.approval_status === "rejected") {
      events.push({ label: `Rejected${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`, description: c.review_note || "", timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "", icon: "cancel", tone: "bg-red-500" });
    } else if (c.approval_status === "changes_requested") {
      events.push({ label: `Changes requested${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`, description: c.review_note || "", timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "", icon: "edit_note", tone: "bg-status-pending" });
    }
    return events;
  }

  return (
    <div>
      <div className="mb-6">
        <nav className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <button onClick={() => navigate("/campaigns")} className="cursor-pointer text-xs font-semibold text-primary hover:underline">Campaigns</button>
          <ChevronRight className="size-3.5 text-border" />
          <span className="font-medium text-foreground">{campaign.name}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight">{campaign.name}</h2>
              <ApprovalBadge status={approvalStatus} />
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              {client?.company_name && <span>{client.company_name}</span>}
              <span className="capitalize">· {campaign.objective} ·</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", campaign.status === "ready" ? "bg-emerald-100 text-emerald-700" : campaign.status === "failed" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground")}>
                {campaign.status}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSubmit && approvalStatus === "pending_review" && (
              <Button variant="outline" className="text-destructive" onClick={handleCancelRequest}>Cancel Request</Button>
            )}
            {approvalStatus === "approved" && (
              <Button variant="outline" onClick={() => setShowEditWarning(true)}>
                <Pencil className="mr-1 size-3.5" /> Edit
              </Button>
            )}
            {(approvalStatus === "draft" || approvalStatus === "approved") && campaign.status === "ready" && (
              <>
                <Button variant="outline" onClick={() => setShowScheduler(true)} disabled={!!busy}>
                  <CalendarDays className="mr-1 size-3.5" /> Schedule
                </Button>
                <Button variant="outline" onClick={() => setShowAutopilot(true)} disabled={!!busy}>
                  <Sparkles className="mr-1 size-3.5" /> AI auto-schedule
                </Button>
              </>
            )}
            {isEditorMode && (
              <>
                <Button variant="outline" onClick={regenerateAll} disabled={!!busy || campaign.status === "generating"}>Regenerate all</Button>
                <Button variant="outline" className="text-destructive" onClick={remove}>Delete</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {campaign.status === "failed" && <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700">{campaign.error}</div>}
      {busy && <div className="mb-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700">{busy}</div>}

      {approvalStatus === "approved" && campaign.reviewed_by && (
        <ApprovedBanner reviewerName={approverName(campaign.reviewed_by)} reviewedAt={campaign.reviewed_at ?? ""} quote={campaign.review_note || "Looks great, proceed with the launch!"} />
      )}
      {approvalStatus === "approved" && (
        <EditWarningDialog visible={showEditWarning} onCancel={() => setShowEditWarning(false)}
          onConfirm={() => { setShowEditWarning(false); toast.info("Editing mode enabled — approval will be voided on save"); }} />
      )}
      {approvalStatus === "changes_requested" && campaign.review_note && (
        <div className="mb-6 flex items-start gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <span className="material-symbols-outlined">edit_note</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-800">Changes requested by {approverName(campaign.reviewed_by)}</h3>
            <p className="mt-1 text-sm text-amber-700">"{campaign.review_note}"</p>
          </div>
        </div>
      )}
      {approvalStatus === "rejected" && (
        <div className="mb-6 flex items-start gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <span className="material-symbols-outlined">cancel</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-red-800">Campaign rejected{campaign.reviewed_by ? ` by ${approverName(campaign.reviewed_by)}` : ""}</h3>
            {campaign.review_note && <p className="mt-1 text-sm text-red-700">"{campaign.review_note}"</p>}
          </div>
        </div>
      )}

      {campaign.status === "generating" && (
        <Card className="mb-4">
          <CardContent className="py-4">
            <strong>Generating campaign…</strong>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full w-[35%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">The Editorial and Visual agents are working. This can take a minute.</p>
          </CardContent>
        </Card>
      )}

      {campaign.status !== "generating" && (
        <>
          {isEditorMode && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[5fr_7fr]">
              <div className="flex flex-col gap-6">
                <Card>
                  <CardContent className="space-y-3 py-5">
                    <h3 className="text-lg font-semibold">Campaign Details</h3>
                    <div>
                      <Label className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign Name</Label>
                      <div className="rounded-lg bg-accent p-3 text-sm text-foreground">{campaign.name}</div>
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goal</Label>
                      <div className="rounded-lg bg-accent p-3 text-sm font-semibold capitalize text-primary">{campaign.objective}</div>
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platforms</Label>
                      <div className="flex flex-wrap gap-2">
                        {activePlatforms.map((p) => (
                          <span key={p.platform} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-semibold capitalize text-primary-foreground">
                            <PlatformIcon platform={p.platform} size={12} /> {p.platform}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date Range</Label>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 rounded-lg bg-accent p-3 text-sm">
                          {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : "—"}
                        </div>
                        <span className="text-muted-foreground">to</span>
                        <div className="flex-1 rounded-lg bg-accent p-3 text-sm">
                          {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : "—"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <div className="rounded-xl border border-primary/20 bg-accent p-6">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary p-2 text-primary-foreground">
                      <span className="material-symbols-outlined">lightbulb</span>
                    </div>
                    <div>
                      <h4 className="mb-1 text-sm font-bold text-primary">Smart Suggestion</h4>
                      <p className="text-sm text-muted-foreground">Based on previous campaigns, we recommend scheduling posts mid-week for peak engagement.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Campaign Posts ({new Set(campaign.posts.map((p) => p.element_id ?? p.id)).size})</h3>
                </div>
                {(() => {
                  const present = POST_TYPE_ORDER.filter((t) => campaign.posts.some((p) => postType(p, campaign.elements) === t));
                  if (present.length > 1) {
                    return (
                      <Tabs value={postTypeTab} onValueChange={setPostTypeTab} className="mb-3">
                        <TabsList className="flex-wrap h-auto">
                          <TabsTrigger value="all" className="gap-1.5">All <span className="text-[0.65rem] opacity-70">{campaign.posts.length}</span></TabsTrigger>
                          {present.map((t) => (
                            <TabsTrigger key={t} value={t} className="gap-1.5">
                              <span className="material-symbols-outlined text-base">{POST_TYPE_META[t].icon}</span>
                              {POST_TYPE_META[t].label}
                              <span className="text-[0.65rem] opacity-70">{campaign.posts.filter((p) => postType(p, campaign.elements) === t).length}</span>
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    );
                  }
                  return null;
                })()}
                <div className="flex flex-col gap-3">
                  {campaign.posts.length === 0 && (
                    <p className="text-sm text-muted-foreground">No posts yet. Generate the campaign first.</p>
                  )}
                  {(() => {
                    const visible = campaign.posts.filter(
                      (post) => postTypeTab === "all" || postType(post, campaign.elements) === postTypeTab,
                    );
                    const groups: { key: string; elementId: string | null; posts: Post[] }[] = [];
                    const byElement = new Map<string, Post[]>();
                    for (const post of visible) {
                      if (post.element_id) {
                        if (!byElement.has(post.element_id)) {
                          byElement.set(post.element_id, []);
                          groups.push({ key: post.element_id, elementId: post.element_id, posts: byElement.get(post.element_id)! });
                        }
                        byElement.get(post.element_id)!.push(post);
                      } else {
                        groups.push({ key: post.id, elementId: null, posts: [post] });
                      }
                    }
                    return groups.map((group) => {
                      const rep = group.posts[0];
                      const el = campaign.elements.find((e) => e.id === group.elementId);
                      const cover = el?.images.find((i) => i.base_object_key);
                      const coverVid = el?.videos.find((v) => v.base_object_key && v.status === "ready");
                      const ptype = postType(rep, campaign.elements);
                      const typeMeta = POST_TYPE_META[ptype];
                      const platforms = Array.from(new Set(group.posts.map((p) => p.platform)));
                      const ratios = el
                        ? Array.from(new Set(
                            el.images.map((i) => i.aspect_ratio).filter(Boolean).length > 0
                              ? el.images.map((i) => i.aspect_ratio).filter(Boolean)
                              : Object.values(el.platform_ratios || {}),
                          ))
                        : [];
                      return (
                        <div key={group.key}
                          onClick={() => { if (group.elementId) setOpenElementId(group.elementId); }}
                          className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow", group.elementId && "cursor-pointer hover:shadow-md")}>
                          <div className="flex min-h-32">
                            <div className="size-32 flex-shrink-0 bg-muted">
                              {cover ? <PostThumbnail campaignId={campaign.id} image={cover} />
                              : coverVid ? <ElementVideoThumb campaignId={campaign.id} video={coverVid} />
                              : ptype === "text" ? (
                                <div className="flex size-full items-center justify-center bg-accent p-2">
                                  <p className="line-clamp-4 text-center text-[0.65rem] font-medium leading-snug text-accent-foreground">{rep.headline || rep.copy || "Text post"}</p>
                                </div>
                              ) : ptype === "video" ? (
                                <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground/50">
                                  <span className="material-symbols-outlined text-3xl">movie</span>
                                  <span className="text-[0.6rem] font-medium uppercase tracking-wider">Reel</span>
                                </div>
                              ) : (
                                <div className="flex size-full items-center justify-center text-muted-foreground/40">
                                  <span className="material-symbols-outlined text-3xl">image</span>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-1 flex-col justify-center gap-2 p-4">
                              <div>
                                <p className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary">
                                  <span className="material-symbols-outlined text-sm">{typeMeta.icon}</span>
                                  {typeMeta.singular}
                                </p>
                                <h4 className="line-clamp-1 text-sm font-semibold">{rep.headline || "Untitled"}</h4>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                {platforms.map((p) => <PlatformIcon key={p} platform={p} size={15} />)}
                                <span className="text-[0.7rem]">{platforms.length} platform{platforms.length !== 1 ? "s" : ""}</span>
                                {ratios.length > 0 && (
                                  <span className="ml-1 flex flex-wrap gap-1">
                                    {ratios.map((r) => (
                                      <span key={r} className="rounded-full bg-accent px-1.5 py-0.5 text-[0.65rem] font-medium text-accent-foreground">{r}</span>
                                    ))}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <QuickSchedule campaignId={campaign.id} post={rep} onDone={load} />
                                {rep.approval_status && <ApprovalBadge status={rep.approval_status} className="shrink-0 px-2 py-0.5 text-[0.65rem]" />}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}

          {!isEditorMode && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              <div className="relative">
                {isLocked && <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/15 backdrop-blur-[1px]" />}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {[...campaign.elements].sort((a, b) => a.position - b.position).map((el) => (
                    <ElementCard key={el.id} campaignId={campaign.id} element={el}
                      posts={campaign.posts.filter((p) => p.element_id === el.id)}
                      onOpen={() => setOpenElementId(el.id)} />
                  ))}
                  {orphanPosts.map((post) => (
                    <div key={post.id} className="cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md" onClick={() => setOpenElementId(`post:${post.id}`)}>
                      <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100"><div className="p-8 text-2xl">📝</div></div>
                      <div className="flex flex-col gap-1.5 p-3">
                        <strong className="text-sm font-semibold">{post.headline || "Post"}</strong>
                        <div className="flex flex-wrap gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary-soft-border bg-accent px-2 py-0.5 text-[0.7rem] font-medium capitalize text-primary">
                            <PlatformIcon platform={post.platform} size={12} /> {post.platform}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="flex flex-col gap-4">
                {approvalStatus === "pending_review" && canReview && (
                  <Card>
                    <CardContent className="space-y-3 py-5">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-primary">Review Decision</h4>
                      <ApproverMeta name={approverName(campaign.assigned_approver_id)} dueDate={campaign.approval_due_date} scope={campaign.approval_scope} />
                      <div className="mt-4">
                        <TextareaZoom label="Reviewer feedback" rows={3} value={reviewNote} onChange={setReviewNote} placeholder="Add your feedback… (required to request changes)" />
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleApprove} disabled={!!busyApproval}>
                          <span className="material-symbols-outlined mr-1 text-base">check_circle</span> Approve Campaign
                        </Button>
                        <div className="flex gap-2">
                          <Button className="flex-1 bg-amber-500 text-white hover:bg-amber-600" onClick={handleRequestChanges} disabled={!!busyApproval}>
                            Request Changes
                          </Button>
                          <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={!!busyApproval}>
                            Reject
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {approvalStatus === "pending_review" && !canReview && (
                  <Card>
                    <CardContent className="space-y-3 py-5">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-primary">Approval Details</h4>
                      <ApproverMeta name={approverName(campaign.assigned_approver_id)} dueDate={campaign.approval_due_date} scope={campaign.approval_scope} />
                      <div className="mt-4 flex items-start gap-3 rounded-lg bg-accent p-3">
                        <span className="material-symbols-outlined text-base text-amber-600">info</span>
                        <p className="text-xs leading-relaxed text-muted-foreground">Changes are disabled until a decision is made or the request is cancelled.</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {approvalStatus === "approved" && (
                  <Card>
                    <CardContent className="space-y-3 py-5">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-primary">Campaign Info</h4>
                      <dl className="space-y-3 text-sm">
                        <div>
                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Objective</dt>
                          <dd className="font-semibold capitalize">{campaign.objective}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Dates</dt>
                          <dd className="font-semibold">{campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : "—"} – {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : "—"}</dd>
                        </div>
                        <div>
                          <dt className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Platforms</dt>
                          <dd className="flex flex-wrap gap-1.5">
                            {activePlatforms.map((p) => (
                              <span key={p.platform} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold capitalize text-accent-foreground">
                                <PlatformIcon platform={p.platform} size={11} /> {p.platform}
                              </span>
                            ))}
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                )}

                <ApprovalTimeline events={buildTimeline(campaign)} title={approvalStatus === "approved" ? "Workflow History" : "Activity Timeline"} />
              </aside>
            </div>
          )}

          {campaign.status === "ready" && !isEditorMode && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
              <strong>Export:</strong>
              {(["zip", "pdf", "json", "csv"] as const).map((fmt) => (
                <Button key={fmt} variant="ghost" size="sm" onClick={() => downloadFile(`/campaigns/${campaign.id}/export?format=${fmt}`, `campaign_${campaign.id}.${fmt}`)}>
                  {fmt.toUpperCase()}
                </Button>
              ))}
            </div>
          )}

          <div className="mt-6">
            <WorkflowStepper currentStep={workflowStep} />
          </div>
          {isEditorMode && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Draft mode</p>
              <Button onClick={() => navigate(`/campaigns/${campaign.id}/preview`)}>
                <Eye className="mr-1 size-4" /> Preview
              </Button>
            </div>
          )}
        </>
      )}

      {openElement && (
        <ElementModal campaignId={campaign.id} element={openElement}
          posts={campaign.posts.filter((p) => p.element_id === openElement.id)}
          client={client} models={models} videoModels={videoModels}
          canEdit={canEdit && campaign.status !== "generating"}
          onChange={load} onClose={() => setOpenElementId(null)} />
      )}
      {openOrphan && (
        <ElementModal campaignId={campaign.id} element={null} posts={[openOrphan]}
          client={client} models={models} videoModels={videoModels}
          canEdit={canEdit && campaign.status !== "generating"}
          onChange={load} onClose={() => setOpenElementId(null)} />
      )}
      {showAutopilot && <AutopilotModal campaignId={campaign.id} onClose={() => setShowAutopilot(false)} onDone={load} />}
      {showScheduler && (
        <CampaignSchedulerModal campaignId={campaign.id}
          startDate={campaign.start_date} endDate={campaign.end_date}
          onClose={() => setShowScheduler(false)} onDone={load} />
      )}
    </div>
  );
}

function ApproverMeta({ name, dueDate, scope }: { name: string; dueDate: string | null; scope: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
          {name.charAt(0) || "?"}
        </div>
        <div>
          <p className="text-sm font-bold">{name || "—"}</p>
          <p className="text-xs text-muted-foreground">Approver</p>
        </div>
      </div>
      <div className="flex justify-between border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Due Date</p>
          <p className="text-sm font-semibold">{dueDate ? new Date(dueDate).toLocaleDateString() : "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Scope</p>
          <p className="text-sm font-semibold">{scope === "full_campaign" ? "Full Campaign" : "Individual Posts"}</p>
        </div>
      </div>
    </div>
  );
}

function QuickSchedule({ campaignId, post, onDone }: { campaignId: string; post: Post; onDone: () => void }) {
  const ps = post.publish_state;
  const isScheduled = ps?.status === "scheduled" && !!ps.scheduled_at;
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<Date | null>(ps?.scheduled_at ? new Date(ps.scheduled_at) : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setWhen(ps?.scheduled_at ? new Date(ps.scheduled_at) : null); }, [ps?.scheduled_at]);

  async function save() {
    if (!when) return;
    if (when <= new Date()) { toast.error("Pick a future date and time"); return; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setBusy(true);
    try {
      let blocked: string | undefined;
      if (isScheduled && ps?.id) {
        const r = await api<{ blocked_reason?: string }>(`/scheduled-posts/${ps.id}`, { method: "PATCH", body: { scheduled_at: when.toISOString(), timezone: tz } });
        blocked = r.blocked_reason;
      } else {
        const r = await api<{ blocked_reason?: string }>(`/campaigns/${campaignId}/posts/${post.id}/schedule`, { method: "POST", body: { scheduled_at: when.toISOString(), timezone: tz } });
        blocked = r.blocked_reason;
      }
      toast.success("Schedule updated");
      if (blocked === "waiting_approval") {
        toast.warning("This post is not approved yet — it will NOT publish until someone approves it.", { duration: 8000 });
      } else if (blocked === "needs_channel") {
        toast.warning("No connected channel for this platform — the post will NOT publish until one is connected.", { duration: 8000 });
      }
      setOpen(false);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Scheduling failed"); }
    finally { setBusy(false); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}
          className={cn(
            "group/qs inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 transition-colors",
            isScheduled ? "border-primary/20 bg-primary/5 font-medium text-foreground hover:bg-primary/10"
              : "border-dashed border-border bg-muted/40 text-muted-foreground hover:border-primary/30 hover:bg-muted",
          )}
          title={isScheduled ? "Click to change date & time" : post.best_time ? `AI suggested: ${post.best_time} — click to set a date & time` : "Click to set date & time"}>
          <span className="material-symbols-outlined shrink-0 text-sm leading-none">{isScheduled ? "event_available" : "schedule"}</span>
          <span className="truncate leading-none">
            {isScheduled && ps?.scheduled_at
              ? new Date(ps.scheduled_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : "Set schedule"}
          </span>
          <span className="material-symbols-outlined shrink-0 text-sm leading-none opacity-0 transition-opacity group-hover/qs:opacity-60">edit</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-3 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-medium">Schedule this post</p>
        <DateTimePicker value={when} onChange={setWhen} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy || !when}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ElementCard({ campaignId, element, posts, onOpen }: { campaignId: string; element: CampaignElement; posts: Post[]; onOpen: () => void }) {
  const cover = element.images.find((i) => i.base_object_key) ?? null;
  const coverVideo = element.videos.find((v) => v.base_object_key && v.status === "ready") ?? null;
  const isGenerating = element.images.some((i) => i.status === "generating") || element.videos.some((v) => v.status === "generating");
  const ratios = Array.from(new Set([...element.images.map((i) => i.aspect_ratio), ...element.videos.map((v) => v.aspect_ratio)]));
  const generatedCount = element.images.filter((i) => i.base_object_key).length;
  const videoCount = element.videos.length;
  const readyVideos = element.videos.filter((v) => v.base_object_key).length;
  const headline = posts[0]?.headline || element.theme;
  const meta = [
    element.element_type as string, ratios.join(", "),
    element.images.length > 0 ? `${generatedCount}/${element.images.length} images` : "",
    videoCount > 0 ? `${readyVideos}/${videoCount} video${videoCount > 1 ? "s" : ""}` : "",
  ].filter(Boolean);

  const publishedCount = posts.filter((p) => p.publish_state?.status === "published").length;
  const publishingCount = posts.filter((p) => p.publish_state?.status === "publishing").length;
  const scheduledCount = posts.filter((p) => p.publish_state?.status === "scheduled").length;
  const failedCount = posts.filter((p) => p.publish_state?.status === "failed").length;

  return (
    <div className="cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md" onClick={onOpen}>
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
        {isGenerating ? (
          <div className="p-8 text-sm text-muted-foreground">
            Generating image…
            <div className="mt-2 h-2 w-[80%] overflow-hidden rounded-full bg-border">
              <div className="h-full w-[35%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
          </div>
        ) : cover ? <ElementThumb campaignId={campaignId} image={cover} />
        : coverVideo ? <ElementVideoThumb campaignId={campaignId} video={coverVideo} />
        : element.element_type === "text" ? <div className="p-8 text-sm text-muted-foreground">Text only</div>
        : <div className="p-8 text-sm text-muted-foreground">{videoCount > 0 && element.images.length === 0 ? "🎬 No video yet" : "No image yet"}</div>}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <strong className="line-clamp-2 text-sm font-semibold">{headline}</strong>
        <div className="flex flex-wrap gap-1">
          {element.platforms.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full border border-primary-soft-border bg-accent px-2 py-0.5 text-[0.7rem] font-medium capitalize text-primary">
              <PlatformIcon platform={p} size={12} /> {p}
            </span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {meta.join(" · ")}
          {(element.images.some((i) => i.status === "generating") || element.videos.some((v) => v.status === "generating")) && (
            <Badge className="ml-1">generating…</Badge>
          )}
        </div>
        {(publishedCount > 0 || publishingCount > 0 || scheduledCount > 0 || failedCount > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {publishedCount > 0 && <Badge variant="success">✓ {publishedCount} published</Badge>}
            {publishingCount > 0 && <Badge variant="warning">⏳ {publishingCount} publishing</Badge>}
            {scheduledCount > 0 && <Badge variant="secondary">⏰ {scheduledCount} scheduled</Badge>}
            {failedCount > 0 && <Badge variant="destructive">✗ {failedCount} failed</Badge>}
          </div>
        )}
      </div>
    </div>
  );
}

function makeDraft(p: Post): PreviewDraft {
  return { headline: p.headline, copy: p.copy, hashtags: p.hashtags.join(" ") };
}

function PlatformTabs({ posts, value, onValueChange }: { posts: Post[]; value: string; onValueChange: (v: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setShowFade(el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [posts.length]);

  return (
    <div className="relative mb-3">
      <div ref={scrollRef} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tabs value={value} onValueChange={onValueChange}>
          <TabsList className="h-auto w-max justify-start gap-1">
            {posts.map((p) => (
              <TabsTrigger key={p.id} value={p.platform} className="flex-none gap-1.5 px-3">
                <PlatformIcon platform={p.platform} size={14} /> {platformLabel(p.platform)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {showFade && (
        <button type="button" aria-label="Show more platforms"
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
          className="absolute right-0 top-0 bottom-0 flex w-12 items-center justify-end rounded-r-lg bg-gradient-to-l from-muted via-muted/85 to-transparent pr-1.5">
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

function ElementModal({ campaignId, element, posts, client, models, videoModels, canEdit, onChange, onClose }: { campaignId: string; element: CampaignElement | null; posts: Post[]; client: Client | null; models: ImageModel[]; videoModels: VideoModel[]; canEdit: boolean; onChange: () => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState(posts[0]?.platform ?? "");
  const [drafts, setDrafts] = useState<Record<string, PreviewDraft>>(() => Object.fromEntries(posts.map((p) => [p.id, makeDraft(p)])));
  const activePost = posts.find((p) => p.platform === tab) ?? posts[0] ?? null;
  const showPreview = !!element && !!client && posts.length > 0;

  function platformsForRatio(ratio: string): string[] {
    if (!element) return [];
    return element.platforms.filter((p) => (element.platform_ratios?.[p] ?? ratio) === ratio);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {element?.element_type === "video" ? <Film size={18} />
                : element?.element_type === "carousel" ? <Layers size={18} />
                : element?.element_type === "text" ? <Type size={18} />
                : <FileImage size={18} />}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold leading-tight">
                {element ? element.theme || element.element_type : activePost?.headline || "Post"}
              </h2>
              <p className="m-0 truncate text-xs text-muted-foreground">
                {element ? (
                  <>
                    {element.element_type === "carousel"
                      ? `${element.images.length} slides · ${posts.length} platform${posts.length === 1 ? "" : "s"}`
                      : `${element.images.length + element.videos.length} asset${element.images.length + element.videos.length === 1 ? "" : "s"} · ${posts.length} platform${posts.length === 1 ? "" : "s"}`}
                  </>
                ) : (
                  "Post detail"
                )}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>

        <div className={cn("grid flex-1 overflow-y-auto", showPreview ? "lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)_minmax(360px,420px)]" : "lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]")}>
          <div className="flex flex-col gap-4 overflow-y-auto border-r border-border bg-surface-alt/30 p-5">
            {element && (
              <section>
                <header className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Visual</h3>
                  <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">shared across platforms</span>
                </header>
                {element.images.length > 0 && (
                  <ElementVisual campaignId={campaignId} images={element.images} client={client} models={models}
                    canEdit={canEdit} onChange={onChange} platformsForRatio={platformsForRatio} />
                )}
                {element.videos.length > 0 && (
                  <VideoVisual campaignId={campaignId} videos={element.videos} client={client} models={videoModels}
                    canEdit={canEdit} onChange={onChange} platformsForRatio={platformsForRatio} />
                )}
              </section>
            )}
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto p-5">
            {posts.length > 1 && <PlatformTabs posts={posts} value={tab} onValueChange={(v) => setTab(v as typeof tab)} />}
            {activePost && (
              <CopyForm key={activePost.id} campaignId={campaignId} post={activePost}
                canEdit={canEdit} onChange={onChange} setDrafts={setDrafts} />
            )}
            {posts.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-surface-alt/50 p-8 text-center">
                <p className="m-0 text-sm text-muted-foreground">This element has no posts.</p>
              </div>
            )}
          </div>

          {showPreview && (
            <aside className="flex flex-col gap-3 overflow-y-auto border-l border-border bg-surface-alt/50 p-5">
              <header className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</h3>
                <span className="text-[0.65rem] text-muted-foreground">updates as you type</span>
              </header>
              <LivePreviewColumn campaignId={campaignId} element={element!} posts={posts} client={client!} drafts={drafts} activePlatform={tab} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyForm({ campaignId, post, canEdit, onChange, setDrafts }: { campaignId: string; post: Post; canEdit: boolean; onChange: () => Promise<void>; setDrafts?: Dispatch<SetStateAction<Record<string, PreviewDraft>>> }) {
  const [copy, setCopy] = useState(post.copy);
  const [headline, setHeadline] = useState(post.headline);
  const [cta, setCta] = useState(post.cta);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const { user } = useAuth();
  const promptDialog = usePrompt();
  const confirmDialog = useConfirm();
  const limit = PLATFORM_LIMITS[post.platform] ?? 2200;

  const canReview = !!user?.is_platform_admin || user?.org_role === "reviewer" || user?.org_role === "org_admin";
  const canSubmit = canReview || user?.org_role === "analyst" || user?.org_role === "creative";
  const canPublish = !!user?.is_platform_admin || user?.org_role === "org_admin" || user?.org_role === "analyst";
  const ps = post.publish_state;
  const canPublishNow = post.approval_status === "approved"
    && (!ps || (ps.status !== "published" && ps.status !== "publishing" && ps.status !== "scheduled"));

  async function review(action: "submit" | "approve" | "reject") {
    let note = "";
    if (action === "reject") {
      const reason = await promptDialog({
        title: "Reject post", description: "Add an optional note explaining why (the author will see it).",
        placeholder: "Reason for rejection (optional)", confirmLabel: "Reject", destructive: true,
      });
      if (reason === null) return;
      note = reason;
    }
    setBusy(action === "submit" ? "Submitting…" : action === "approve" ? "Approving…" : "Rejecting…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}/${action}`, { method: "POST", body: action === "reject" ? { note } : {} });
      toast.success(action === "submit" ? "Submitted for review" : action === "approve" ? "Post approved" : "Post rejected");
      await onChange();
    } finally { setBusy(""); }
  }

  async function publishNow() {
    const ok = await confirmDialog({
      title: "Publish now", description: "This sends the post to its connected channel immediately. Continue?",
      confirmLabel: "Publish now",
    });
    if (!ok) return;
    setBusy("Publishing…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}/publish`, { method: "POST" });
      toast.success("Post published");
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish the post");
    } finally { setBusy(""); }
  }

  useEffect(() => {
    setCopy(post.copy); setHeadline(post.headline); setCta(post.cta);
    setHashtags(post.hashtags.join(" "));
    setDirty(false);
  }, [post.copy, post.headline, post.cta, post.hashtags]);

  useEffect(() => {
    if (!setDrafts) return;
    setDrafts((prev) => {
      const cur = prev[post.id];
      if (cur && cur.headline === headline && cur.copy === copy && cur.hashtags === hashtags) return prev;
      return { ...prev, [post.id]: { headline, copy, hashtags } };
    });
  }, [headline, copy, hashtags, post.id, setDrafts]);

  async function saveCopy() {
    setBusy("Saving…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}`, {
        method: "PATCH", body: { headline, copy, cta, hashtags: hashtags.split(/\s+/).filter(Boolean) },
      });
      setDirty(false);
      await onChange();
    } finally { setBusy(""); }
  }

  async function regenerate() {
    setBusy("Regenerating copy…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}/regenerate`, { method: "POST", body: {} });
      await onChange();
    } finally { setBusy(""); }
  }

  const mark = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Headline</Label>
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="headline" value={headline}
              onApply={(v) => mark(setHeadline)(v)} variant="chip" />
          )}
        </div>
        <Input value={headline} onChange={(e) => mark(setHeadline)(e.target.value)} readOnly={!canEdit} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            Copy
            <span className={cn("ml-2 text-xs tabular-nums", copy.length > limit ? "text-red-600" : "text-muted-foreground")}>
              {copy.length}/{limit}
            </span>
          </Label>
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="copy" value={copy}
              onApply={(v) => mark(setCopy)(v)} variant="chip" />
          )}
        </div>
        <TextareaZoom label="Copy" rows={6} value={copy} onChange={(v) => mark(setCopy)(v)} readOnly={!canEdit} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Call to action</Label>
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="cta" value={cta}
              onApply={(v) => mark(setCta)(v)} variant="chip" />
          )}
        </div>
        <Input value={cta} onChange={(e) => mark(setCta)(e.target.value)} readOnly={!canEdit} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Hashtags</Label>
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="hashtags" value={hashtags}
              onApply={(v) => mark(setHashtags)(v)} variant="chip" />
          )}
        </div>
        <Input value={hashtags} onChange={(e) => mark(setHashtags)(e.target.value)} readOnly={!canEdit}
          placeholder="#tag1 #tag2 #tag3" />
      </div>

      {post.rationale && (
        <div className="flex gap-2 rounded-md border-l-[3px] border-primary bg-accent/50 px-3 py-2 text-sm text-muted-foreground">
          <Sparkles size={14} className="mt-0.5 flex-shrink-0 text-primary" />
          <span className="leading-relaxed">{post.rationale}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-alt p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={APPROVAL_STATUS_VARIANT[post.approval_status] ?? "secondary"}>
            {APPROVAL_LABELS[post.approval_status] ?? post.approval_status}
          </Badge>
          {ps && <PublishBadge ps={ps} busy={!!busy} />}
          {post.best_time && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays size={12} /> Suggested: <strong className="font-medium text-foreground/80">{post.best_time}</strong>
            </span>
          )}
        </div>
        {post.approval_status === "rejected" && post.review_note && (
          <p className="m-0 rounded-md border-l-[3px] border-red-500 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            {post.review_note}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit && (post.approval_status === "draft" || post.approval_status === "rejected") && (
            <Button variant="outline" size="sm" onClick={() => review("submit")} disabled={!!busy}>
              Submit for review
            </Button>
          )}
          {canReview && post.approval_status === "pending_review" && (
            <Button size="sm" onClick={() => review("approve")} disabled={!!busy}>
              Approve
            </Button>
          )}
          {canReview && post.approval_status === "pending_review" && (
            <Button variant="ghost" size="sm" onClick={() => review("reject")} disabled={!!busy}>
              Reject
            </Button>
          )}
          {canPublish && canPublishNow && (
            <Button size="sm" onClick={publishNow} disabled={!!busy}>
              <Rocket size={14} /> Publish now
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveCopy} disabled={!dirty || !!busy}>
            {busy === "Saving…" ? busy : "Save changes"}
          </Button>
          <Button variant="ghost" size="sm" onClick={regenerate} disabled={!!busy}>
            <Sparkles size={14} className="text-primary" /> Regenerate copy
          </Button>
          {busy && busy !== "Saving…" && (
            <span className="text-xs text-muted-foreground">{busy}</span>
          )}
        </div>
      )}
    </div>
  );
}

function PublishBadge({ ps }: { ps: PublishState; busy?: boolean }) {
  if (ps.status === "published") {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <Badge variant="success">✓ Published</Badge>
        {ps.published_url && (
          <a href={ps.published_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">View post ↗</a>
        )}
      </span>
    );
  }
  if (ps.status === "publishing") return <Badge variant="warning">Publishing…</Badge>;
  if (ps.status === "scheduled") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        ⏰ Scheduled{ps.scheduled_at ? ` for ${new Date(ps.scheduled_at).toLocaleString()}` : ""}
        <BlockedReasonBadge reason={ps.blocked_reason} />
      </span>
    );
  }
  if (ps.status === "retrying" || ps.status === "throttled") {
    return (
      <span title={ps.error} className="inline-block rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        {ps.status === "throttled" ? "⏳ Throttled" : "↻ Retrying…"}
        {ps.retry_count > 0 ? ` (${ps.retry_count}/4)` : ""}
      </span>
    );
  }
  if (ps.status === "failed") return <span className="text-sm text-red-600" title={ps.error}>✗ Failed{ps.error ? `: ${ps.error.slice(0, 120)}` : ""}</span>;
  return null;
}
