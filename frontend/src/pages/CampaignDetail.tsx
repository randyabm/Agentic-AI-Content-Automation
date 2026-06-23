import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarDays, ChevronRight, Download, Eye, EyeOff, Maximize2, Pencil, Sparkles, Upload as UploadIcon, X } from "lucide-react";
import { api, downloadFile } from "../api";
import { getBlobUrl, hashKey } from "../lib/blobCache";
import { ImageEditor } from "../components/ImageEditor";
import { AutopilotModal } from "../components/AutopilotModal";
import { CampaignSchedulerModal } from "../components/CampaignSchedulerModal";
import { TextareaZoom } from "../components/TextareaZoom";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { LivePreviewColumn, type PreviewDraft } from "../components/PostPreview";
import { AiAssist } from "../components/AiAssist";
import { MediaSkeleton } from "../components/MediaSkeleton";
import { ApprovedBanner } from "../components/ApprovedBanner";
import { EditWarningDialog } from "../components/EditWarningDialog";
import { ApprovalTimeline, type TimelineEvent } from "../components/ApprovalTimeline";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { WorkflowStepper } from "../components/WorkflowStepper";
import { toast } from "sonner";
import { useConfirm, usePrompt } from "@/components/ui/dialogs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateTimePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RATIO_PRIORITY } from "../ratios";
import { useAuth } from "../auth";
import type {
  CampaignDetail as Campaign,
  CampaignApprovalStatus,
  CampaignElement,
  Client,
  ImageModel,
  Post,
  PostImage,
  PostVideo,
  PublishState,
  User,
  VideoModel,
} from "../types";

const PLATFORM_LIMITS: Record<string, number> = {
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  tiktok: 2200,
  x: 280,
  youtube: 5000,
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
  const [postPlatformTab, setPostPlatformTab] = useState<string>("all");
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

  const mediaGenerating =
    campaign?.elements.some(
      (el) =>
        el.videos.some((v) => v.status === "generating") ||
        el.images.some((i) => i.status === "generating")
    ) ?? false;

  useEffect(() => {
    if (campaign?.status !== "generating" && !mediaGenerating) return;
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.status, mediaGenerating]);

  if (!campaign) return <div className="page-loading">Loading…</div>;

  // Posts not linked to any element (legacy campaigns) get their own cards.
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
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete campaign",
      description: "This permanently deletes the campaign and all its posts. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusyApproval("");
    }
  }

  async function handleRequestChanges() {
    if (!reviewNote.trim()) {
      toast.error("Add feedback describing the changes needed.");
      return;
    }
    setBusyApproval("Requesting changes…");
    try {
      await api(`/campaigns/${campaign!.id}/request-changes`, { method: "POST", body: { note: reviewNote } });
      toast.success("Changes requested");
      setReviewNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyApproval("");
    }
  }

  async function handleReject() {
    setBusyApproval("Rejecting…");
    try {
      await api(`/campaigns/${campaign!.id}/reject`, { method: "POST", body: { note: reviewNote } });
      toast.success("Campaign rejected");
      setReviewNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyApproval("");
    }
  }

  async function handleCancelRequest() {
    const ok = await confirm({
      title: "Cancel approval request",
      description: "This will withdraw the approval request and return the campaign to draft.",
      confirmLabel: "Cancel Request",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/campaigns/${campaign!.id}/submit-for-approval`, {
        method: "POST",
        body: { assigned_approver_id: "", approval_scope: "full_campaign", message: "" },
      });
      toast.success("Approval request cancelled");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
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

  // Real activity timeline derived from the campaign's approval fields.
  function buildTimeline(c: Campaign): TimelineEvent[] {
    const events: TimelineEvent[] = [
      {
        label: "Campaign created",
        description: "Initial draft",
        timestamp: new Date(c.created_at).toLocaleString(),
        icon: "check_circle",
        tone: "bg-primary",
      },
    ];
    if (c.approval_status !== "draft") {
      events.push({
        label: "Submitted for approval",
        description: c.approval_message || "No message",
        timestamp: "",
        icon: "send",
        tone: "bg-primary",
      });
    }
    if (c.approval_status === "pending_review") {
      events.push({
        label: "Pending review",
        description: `Waiting for ${approverName(c.assigned_approver_id)}`,
        timestamp: c.approval_due_date ? `Due ${new Date(c.approval_due_date).toLocaleDateString()}` : "",
        icon: "pending",
        tone: "bg-status-pending",
      });
    } else if (c.approval_status === "approved") {
      events.push({
        label: `Approved${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`,
        description: c.review_note || "",
        timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "",
        icon: "verified",
        tone: "bg-emerald-500",
      });
    } else if (c.approval_status === "rejected") {
      events.push({
        label: `Rejected${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`,
        description: c.review_note || "",
        timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "",
        icon: "cancel",
        tone: "bg-red-500",
      });
    } else if (c.approval_status === "changes_requested") {
      events.push({
        label: `Changes requested${c.reviewed_by ? ` by ${approverName(c.reviewed_by)}` : ""}`,
        description: c.review_note || "",
        timestamp: c.reviewed_at ? new Date(c.reviewed_at).toLocaleString() : "",
        icon: "edit_note",
        tone: "bg-status-pending",
      });
    }
    return events;
  }

  return (
    <div>
      {/* ===== HEADER ===== */}
      <div className="mb-6">
        <nav className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <button
            onClick={() => navigate("/campaigns")}
            className="cursor-pointer text-xs font-semibold text-primary hover:underline"
          >
            Campaigns
          </button>
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
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  campaign.status === "ready"
                    ? "bg-emerald-100 text-emerald-700"
                    : campaign.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {campaign.status}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSubmit && approvalStatus === "pending_review" && (
              <Button variant="outline" className="text-destructive" onClick={handleCancelRequest}>
                Cancel Request
              </Button>
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
                <Button variant="outline" onClick={regenerateAll} disabled={!!busy || campaign.status === "generating"}>
                  Regenerate all
                </Button>
                <Button variant="outline" className="text-destructive" onClick={remove}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {campaign.status === "failed" && <div className="alert alert-error">{campaign.error}</div>}
      {busy && <div className="alert alert-success">{busy}</div>}

      {/* ===== APPROVAL BANNERS ===== */}
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
            <h3 className="text-sm font-bold text-red-800">
              Campaign rejected{campaign.reviewed_by ? ` by ${approverName(campaign.reviewed_by)}` : ""}
            </h3>
            {campaign.review_note && <p className="mt-1 text-sm text-red-700">"{campaign.review_note}"</p>}
          </div>
        </div>
      )}

      {/* ===== GENERATING PROGRESS ===== */}
      {campaign.status === "generating" && (
        <div className="card progress-card">
          <strong>Generating campaign…</strong>
          <div className="progress-bar"><div className="progress-fill indeterminate" /></div>
          <p className="muted small">The Editorial and Visual agents are working. This can take a minute.</p>
        </div>
      )}

      {/* ===== MAIN CONTENT: CONCEPT UI LAYOUT ===== */}
      {campaign.status !== "generating" && (
        <>
          {/* Editor mode: two-column concept layout */}
          {isEditorMode && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[5fr_7fr]">
              {/* LEFT COLUMN: Campaign Details + Smart Suggestion */}
              <div className="flex flex-col gap-6">
                <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                  <h3 className="mb-4 text-lg font-semibold">Campaign Details</h3>
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign Name</label>
                      <div className="rounded-lg bg-accent p-3 text-sm text-foreground">{campaign.name}</div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goal</label>
                      <div className="rounded-lg bg-accent p-3 text-sm font-semibold capitalize text-primary">{campaign.objective}</div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platforms</label>
                      <div className="flex flex-wrap gap-2">
                        {activePlatforms.map((p) => (
                          <span key={p.platform} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-semibold capitalize text-primary-foreground">
                            <PlatformIcon platform={p.platform} size={12} /> {p.platform}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date Range</label>
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
                  </div>
                </div>

                {/* Smart Suggestion */}
                <div className="rounded-xl border border-primary/20 bg-accent p-6">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary p-2 text-primary-foreground">
                      <span className="material-symbols-outlined">lightbulb</span>
                    </div>
                    <div>
                      <h4 className="mb-1 text-sm font-bold text-primary">Smart Suggestion</h4>
                      <p className="text-sm text-muted-foreground">
                        Based on previous campaigns, we recommend scheduling posts mid-week for peak engagement.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Posts List */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Campaign Posts ({campaign.posts.length})</h3>
                </div>
                {(() => {
                  const platforms = Array.from(new Set(campaign.posts.map((p) => p.platform)));
                  if (platforms.length > 1) {
                    return (
                      <Tabs value={postPlatformTab} onValueChange={setPostPlatformTab} className="mb-3">
                        <TabsList className="flex-wrap h-auto">
                          <TabsTrigger value="all" className="gap-1.5">
                            All <span className="text-[0.65rem] opacity-70">{campaign.posts.length}</span>
                          </TabsTrigger>
                          {platforms.map((pf) => (
                            <TabsTrigger key={pf} value={pf} className="gap-1.5">
                              <PlatformIcon platform={pf} size={14} />
                              {platformLabel(pf)}
                              <span className="text-[0.65rem] opacity-70">
                                {campaign.posts.filter((p) => p.platform === pf).length}
                              </span>
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
                  {campaign.posts
                    .filter((post) => postPlatformTab === "all" || post.platform === postPlatformTab)
                    .map((post) => {
                    const el = campaign.elements.find((e) => e.id === post.element_id);
                    const cover = el?.images.find((i) => i.base_object_key);
                    const coverVid = el?.videos.find((v) => v.base_object_key && v.status === "ready");
                    const typeLabel = el?.element_type === "video" ? "REEL" : el?.element_type === "carousel" ? "CAROUSEL" : "POST";
                    return (
                      <div
                        key={post.id}
                        onClick={() => { if (post.element_id) setOpenElementId(post.element_id); }}
                        className={cn(
                          "overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow",
                          post.element_id && "cursor-pointer hover:shadow-md",
                        )}
                      >
                        <div className="flex h-32">
                          <div className="size-32 flex-shrink-0 bg-muted">
                            {cover ? (
                              <PostThumbnail campaignId={campaign.id} image={cover} />
                            ) : coverVid ? (
                              <ElementVideoThumb campaignId={campaign.id} video={coverVid} />
                            ) : el?.element_type === "text" ? (
                              <div className="flex size-full items-center justify-center bg-accent p-2">
                                <p className="line-clamp-4 text-center text-[0.65rem] font-medium leading-snug text-accent-foreground">
                                  {post.headline || post.copy || "Text post"}
                                </p>
                              </div>
                            ) : el?.element_type === "video" ? (
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
                          <div className="flex flex-1 flex-col justify-between p-4">
                            <div>
                              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">
                                {post.platform.toUpperCase()} {typeLabel}
                              </p>
                              <h4 className="line-clamp-1 text-sm font-semibold">{post.headline || "Untitled"}</h4>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <QuickSchedule campaignId={campaign.id} post={post} onDone={load} />
                              {post.approval_status && <ApprovalBadge status={post.approval_status} className="px-2 py-0.5 text-[0.65rem]" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Non-editor mode (pending_review, approved, rejected): content + contextual sidebar */}
          {!isEditorMode && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              {/* LEFT: campaign content (locked while pending review) */}
              <div className="relative">
                {isLocked && (
                  <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/15 backdrop-blur-[1px]" />
                )}
                <div className="element-grid">
                  {[...campaign.elements].sort((a, b) => a.position - b.position).map((el) => (
                    <ElementCard key={el.id} campaignId={campaign.id} element={el}
                      posts={campaign.posts.filter((p) => p.element_id === el.id)}
                      onOpen={() => setOpenElementId(el.id)} />
                  ))}
                  {orphanPosts.map((post) => (
                    <div key={post.id} className="card element-card" onClick={() => setOpenElementId(`post:${post.id}`)}>
                      <div className="element-thumb"><div className="image-empty">📝</div></div>
                      <div className="element-card-body">
                        <strong className="small">{post.headline || "Post"}</strong>
                        <div className="platform-chips"><span className="chip"><PlatformIcon platform={post.platform} size={12} /> {post.platform}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* RIGHT: status sidebar */}
              <aside className="flex flex-col gap-4">
                {/* Reviewer decision panel (approver only) */}
                {approvalStatus === "pending_review" && canReview && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Review Decision</h4>
                    <ApproverMeta
                      name={approverName(campaign.assigned_approver_id)}
                      dueDate={campaign.approval_due_date}
                      scope={campaign.approval_scope}
                    />
                    <div className="mt-4">
                      <TextareaZoom
                        label="Reviewer feedback"
                        rows={3}
                        value={reviewNote}
                        onChange={setReviewNote}
                        placeholder="Add your feedback… (required to request changes)"
                      />
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      <Button
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={handleApprove}
                        disabled={!!busyApproval}
                      >
                        <span className="material-symbols-outlined mr-1 text-base">check_circle</span> Approve Campaign
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 bg-amber-500 text-white hover:bg-amber-600"
                          onClick={handleRequestChanges}
                          disabled={!!busyApproval}
                        >
                          Request Changes
                        </Button>
                        <Button
                          variant="destructive"
                          className="flex-1"
                          onClick={handleReject}
                          disabled={!!busyApproval}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Read-only approval details (submitter / non-reviewer) */}
                {approvalStatus === "pending_review" && !canReview && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Approval Details</h4>
                    <ApproverMeta
                      name={approverName(campaign.assigned_approver_id)}
                      dueDate={campaign.approval_due_date}
                      scope={campaign.approval_scope}
                    />
                    <div className="mt-4 flex items-start gap-3 rounded-lg bg-accent p-3">
                      <span className="material-symbols-outlined text-base text-amber-600">info</span>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Changes are disabled until a decision is made or the request is cancelled.
                      </p>
                    </div>
                  </div>
                )}

                {/* Approved: campaign info */}
                {approvalStatus === "approved" && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Campaign Info</h4>
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-muted-foreground">Objective</dt>
                        <dd className="font-semibold capitalize">{campaign.objective}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-muted-foreground">Dates</dt>
                        <dd className="font-semibold">
                          {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : "—"} –{" "}
                          {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : "—"}
                        </dd>
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
                  </div>
                )}

                <ApprovalTimeline
                  events={buildTimeline(campaign)}
                  title={approvalStatus === "approved" ? "Workflow History" : "Activity Timeline"}
                />
              </aside>
            </div>
          )}

          {/* Export bar for ready campaigns */}
          {campaign.status === "ready" && !isEditorMode && (
            <div className="card export-bar" style={{ marginTop: "1rem" }}>
              <strong>Export:</strong>
              {(["zip", "pdf", "json", "csv"] as const).map((fmt) => (
                <Button key={fmt} variant="ghost" size="sm"
                  onClick={() => downloadFile(`/campaigns/${campaign.id}/export?format=${fmt}`, `campaign_${campaign.id}.${fmt}`)}>
                  {fmt.toUpperCase()}
                </Button>
              ))}
            </div>
          )}

          {/* ===== APPROVAL WORKFLOW ===== */}
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

      {/* ===== MODALS ===== */}
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
      {showAutopilot && (
        <AutopilotModal campaignId={campaign.id} onClose={() => setShowAutopilot(false)} onDone={load} />
      )}
      {showScheduler && (
        <CampaignSchedulerModal
          campaignId={campaign.id}
          startDate={campaign.start_date}
          endDate={campaign.end_date}
          onClose={() => setShowScheduler(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

function ApproverMeta({
  name,
  dueDate,
  scope,
}: {
  name: string;
  dueDate: string | null;
  scope: string;
}) {
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

/** Inline quick-schedule on a post card: click the time chip to set/change the
 *  publish date & time without opening the full Schedule modal. Reschedules an
 *  existing ScheduledPost (PATCH) or creates one (POST). */
function QuickSchedule({ campaignId, post, onDone }: { campaignId: string; post: Post; onDone: () => void }) {
  const ps = post.publish_state;
  const isScheduled = ps?.status === "scheduled" && !!ps.scheduled_at;
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<Date | null>(ps?.scheduled_at ? new Date(ps.scheduled_at) : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWhen(ps?.scheduled_at ? new Date(ps.scheduled_at) : null);
  }, [ps?.scheduled_at]);

  async function save() {
    if (!when) return;
    if (when <= new Date()) {
      toast.error("Pick a future date and time");
      return;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setBusy(true);
    try {
      if (isScheduled && ps?.id) {
        await api(`/scheduled-posts/${ps.id}`, {
          method: "PATCH",
          body: { scheduled_at: when.toISOString(), timezone: tz },
        });
      } else {
        await api(`/campaigns/${campaignId}/posts/${post.id}/schedule`, {
          method: "POST",
          body: { scheduled_at: when.toISOString(), timezone: tz },
        });
      }
      toast.success("Schedule updated");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scheduling failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted",
            isScheduled ? "font-medium text-foreground" : "text-muted-foreground",
          )}
          title="Click to set date & time"
        >
          <span className="material-symbols-outlined text-xs">
            {isScheduled ? "event_available" : "schedule"}
          </span>
          {isScheduled && ps?.scheduled_at
            ? new Date(ps.scheduled_at).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : post.best_time
              ? post.best_time
              : "Set schedule"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto space-y-3 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-medium">Schedule this post</p>
        <DateTimePicker value={when} onChange={setWhen} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !when}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PostThumbnail({ campaignId, image }: { campaignId: string; image: PostImage }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!image.base_object_key) return;
    let active = true;
    import("../lib/blobCache").then(({ getBlobUrl }) => {
      getBlobUrl(`/campaigns/${campaignId}/images/${image.id}/display`).then((u) => { if (active) setUrl(u); });
    });
    return () => { active = false; };
  }, [campaignId, image.id, image.base_object_key]);
  return url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" /> : null;
}

function ElementCard({
  campaignId,
  element,
  posts,
  onOpen,
}: {
  campaignId: string;
  element: CampaignElement;
  posts: Post[];
  onOpen: () => void;
}) {
  const cover = element.images.find((i) => i.base_object_key) ?? null;
  const coverVideo = element.videos.find((v) => v.base_object_key && v.status === "ready") ?? null;
  const isGenerating =
    element.images.some((i) => i.status === "generating") ||
    element.videos.some((v) => v.status === "generating");
  const ratios = Array.from(
    new Set([...element.images.map((i) => i.aspect_ratio), ...element.videos.map((v) => v.aspect_ratio)])
  );
  const generatedCount = element.images.filter((i) => i.base_object_key).length;
  const videoCount = element.videos.length;
  const readyVideos = element.videos.filter((v) => v.base_object_key).length;
  const headline = posts[0]?.headline || element.theme;
  const meta = [
    element.element_type as string,
    ratios.join(", "),
    element.images.length > 0 ? `${generatedCount}/${element.images.length} images` : "",
    videoCount > 0 ? `${readyVideos}/${videoCount} video${videoCount > 1 ? "s" : ""}` : "",
  ].filter(Boolean);

  // Publish summary across this element's posts (shown as a card badge)
  const publishedCount = posts.filter((p) => p.publish_state?.status === "published" || p.publish_state?.status === "partial").length;
  const publishingCount = posts.filter((p) => p.publish_state?.status === "publishing").length;
  const scheduledCount = posts.filter((p) => p.publish_state?.status === "scheduled").length;
  const failedCount = posts.filter((p) => p.publish_state?.status === "failed").length;

  return (
    <div className="card element-card" onClick={onOpen}>
      <div className="element-thumb">
        {isGenerating ? (
          <div className="image-empty">
            Generating image…
            <div className="progress-bar" style={{ width: "80%" }}>
              <div className="progress-fill indeterminate" />
            </div>
          </div>
        ) : cover ? (
          <ElementThumb campaignId={campaignId} image={cover} />
        ) : coverVideo ? (
          <ElementVideoThumb campaignId={campaignId} video={coverVideo} />
        ) : element.element_type === "text" ? (
          <div className="image-empty muted">Text only</div>
        ) : (
          <div className="image-empty">{videoCount > 0 && element.images.length === 0 ? "🎬 No video yet" : "No image yet"}</div>
        )}
      </div>
      <div className="element-card-body">
        <strong className="small element-headline">{headline}</strong>
        <div className="platform-chips">
          {element.platforms.map((p) => (
            <span key={p} className="chip">
              <PlatformIcon platform={p} size={12} /> {p}
            </span>
          ))}
        </div>
        <div className="muted small element-meta">
          {meta.join(" · ")}
          {(element.images.some((i) => i.status === "generating") ||
            element.videos.some((v) => v.status === "generating")) && (
            <span className="tag"> generating…</span>
          )}
        </div>
        {(publishedCount > 0 || publishingCount > 0 || scheduledCount > 0 || failedCount > 0) && (
          <div className="platform-chips" style={{ marginTop: 4 }}>
            {publishedCount > 0 && (
              <span className="tag approval-approved">✓ {publishedCount} published</span>
            )}
            {publishingCount > 0 && (
              <span className="tag approval-pending_review">⏳ {publishingCount} publishing</span>
            )}
            {scheduledCount > 0 && (
              <span className="tag">⏰ {scheduledCount} scheduled</span>
            )}
            {failedCount > 0 && (
              <span className="tag approval-rejected">✗ {failedCount} failed</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ElementVideoThumb({ campaignId, video }: { campaignId: string; video: PostVideo }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}`).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [campaignId, video.id, video.base_object_key]);
  return url ? (
    <video src={url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <div className="image-empty">🎬</div>
  );
}

function ElementThumb({ campaignId, image }: { campaignId: string; image: PostImage }) {
  const { preview } = useImageUrl(campaignId, image);
  return preview ? <img src={preview} alt="element" loading="lazy" /> : <div className="image-empty">…</div>;
}

// Resolve blob URLs for an image: a small WebP preview (≤800px) and a larger
// WebP for the lightbox (≤1600px). Both go through the /display route which
// serves the appropriate variant (composite or base) and falls back to the
// full-res base for legacy images without display variants.
function useImageUrl(campaignId: string, image: PostImage): { preview: string; full: string } {
  const [preview, setPreview] = useState("");
  const [full, setFull] = useState("");
  const state = image.canvas_state || {};
  const hasLayers =
    (state.logo?.visible !== false && !!state.logo) ||
    (state.assets || []).some((a) => a.visible !== false) ||
    (state.texts || []).some((t) => t.visible !== false);
  useEffect(() => {
    if (!image.base_object_key) {
      setPreview("");
      setFull("");
      return;
    }
    let active = true;
    const isComposite = image.composited_object_key || hasLayers;
    const version = isComposite
      ? hashKey(`${image.base_object_key}|${JSON.stringify(image.canvas_state || {})}`)
      : image.base_object_key;
    const previewPath = `/campaigns/${campaignId}/images/${image.id}/display?v=${version}`;
    const fullPath = `/campaigns/${campaignId}/images/${image.id}/display?v=${version}&w=1600`;
    getBlobUrl(previewPath).then((u) => {
      if (active) setPreview(u);
    });
    getBlobUrl(fullPath).then((u) => {
      if (active) setFull(u);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, image.id, image.base_object_key, image.composited_object_key, hasLayers, image.canvas_state]);
  return { preview, full };
}

function makeDraft(p: Post): PreviewDraft {
  return { headline: p.headline, copy: p.copy, hashtags: p.hashtags.join(" ") };
}

/** Platform switcher: a single scrollable row with a right-edge gradient +
 *  chevron shown only when more tabs are hidden off-screen. Clicking the
 *  chevron scrolls the row forward. */
function PlatformTabs({
  posts,
  value,
  onValueChange,
}: {
  posts: Post[];
  value: string;
  onValueChange: (v: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setShowFade(el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
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
        <button
          type="button"
          aria-label="Show more platforms"
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
          className="absolute right-0 top-0 bottom-0 flex w-12 items-center justify-end rounded-r-lg bg-gradient-to-l from-muted via-muted/85 to-transparent pr-1.5"
        >
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

function ElementModal({
  campaignId,
  element,
  posts,
  client,
  models,
  videoModels,
  canEdit,
  onChange,
  onClose,
}: {
  campaignId: string;
  element: CampaignElement | null;
  posts: Post[];
  client: Client | null;
  models: ImageModel[];
  videoModels: VideoModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(posts[0]?.platform ?? "");
  // Live drafts feed the right-hand preview column in real time. Each CopyForm
  // reports its in-progress edits here so the preview updates as you type —
  // without saving or reopening anything.
  const [drafts, setDrafts] = useState<Record<string, PreviewDraft>>(() =>
    Object.fromEntries(posts.map((p) => [p.id, makeDraft(p)])),
  );
  const activePost = posts.find((p) => p.platform === tab) ?? posts[0] ?? null;
  const showPreview = !!element && !!client && posts.length > 0;

  // Platforms sharing each image's ratio, so a visual is shown once with its audience.
  function platformsForRatio(ratio: string): string[] {
    if (!element) return [];
    return element.platforms.filter((p) => (element.platform_ratios?.[p] ?? ratio) === ratio);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal element-modal ${showPreview ? "composer-modal" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{element ? element.theme || element.element_type : activePost?.headline || "Post"}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className={showPreview ? "composer-layout" : "element-modal-layout"}>
          <div className="composer-editor">
            {element && (
              <div className="element-visuals">
                <h3 className="composer-section-title">Visual (shared across platforms)</h3>
                {element.images.length > 0 && (
                  <ElementVisual
                    campaignId={campaignId}
                    images={element.images}
                    client={client}
                    models={models}
                    canEdit={canEdit}
                    onChange={onChange}
                    platformsForRatio={platformsForRatio}
                  />
                )}
                {element.videos.length > 0 && (
                  <VideoVisual
                    campaignId={campaignId}
                    videos={element.videos}
                    client={client}
                    models={videoModels}
                    canEdit={canEdit}
                    onChange={onChange}
                    platformsForRatio={platformsForRatio}
                  />
                )}
              </div>
            )}

            <div className="element-copy">
              {posts.length > 1 && (
                <PlatformTabs posts={posts} value={tab} onValueChange={(v) => setTab(v as typeof tab)} />
              )}
              {activePost && (
                <CopyForm
                  key={activePost.id}
                  campaignId={campaignId}
                  post={activePost}
                  canEdit={canEdit}
                  onChange={onChange}
                  setDrafts={setDrafts}
                />
              )}
              {posts.length === 0 && <p className="muted small">This element has no posts.</p>}
            </div>
          </div>

          {showPreview && (
            <aside className="composer-preview">
              <div className="composer-preview-head">
                <span className="small muted">Live preview</span>
                <span className="small muted">updates as you type</span>
              </div>
              <LivePreviewColumn
                campaignId={campaignId}
                element={element!}
                posts={posts}
                client={client!}
                drafts={drafts}
                activePlatform={tab}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyForm({
  campaignId,
  post,
  canEdit,
  onChange,
  setDrafts,
}: {
  campaignId: string;
  post: Post;
  canEdit: boolean;
  onChange: () => Promise<void>;
  setDrafts?: Dispatch<SetStateAction<Record<string, PreviewDraft>>>;
}) {
  const [copy, setCopy] = useState(post.copy);
  const [headline, setHeadline] = useState(post.headline);
  const [cta, setCta] = useState(post.cta);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const { user } = useAuth();
  const promptDialog = usePrompt();
  const limit = PLATFORM_LIMITS[post.platform] ?? 2200;

  const canReview =
    !!user?.is_platform_admin || user?.org_role === "reviewer" || user?.org_role === "org_admin";
  const canSubmit =
    canReview || user?.org_role === "analyst" || user?.org_role === "creative";

  // Persistent publish status comes from the server (post.publish_state).
  // Publishing/scheduling itself is handled from the global Calendar.
  const ps = post.publish_state;

  async function review(action: "submit" | "approve" | "reject") {
    let note = "";
    if (action === "reject") {
      const reason = await promptDialog({
        title: "Reject post",
        description: "Add an optional note explaining why (the author will see it).",
        placeholder: "Reason for rejection (optional)",
        confirmLabel: "Reject",
        destructive: true,
      });
      if (reason === null) return; // cancelled
      note = reason;
    }
    setBusy(action === "submit" ? "Submitting…" : action === "approve" ? "Approving…" : "Rejecting…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}/${action}`, {
        method: "POST",
        body: action === "reject" ? { note } : {},
      });
      toast.success(
        action === "submit" ? "Submitted for review" : action === "approve" ? "Post approved" : "Post rejected",
      );
      await onChange();
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    setCopy(post.copy);
    setHeadline(post.headline);
    setCta(post.cta);
    setHashtags(post.hashtags.join(" "));
    setDirty(false);
  }, [post.copy, post.headline, post.cta, post.hashtags]);

  // Mirror in-progress edits into the shared drafts map so the live preview
  // column reflects them immediately. Guarded to avoid a re-render loop.
  useEffect(() => {
    if (!setDrafts) return;
    setDrafts((prev) => {
      const cur = prev[post.id];
      if (cur && cur.headline === headline && cur.copy === copy && cur.hashtags === hashtags) {
        return prev;
      }
      return { ...prev, [post.id]: { headline, copy, hashtags } };
    });
  }, [headline, copy, hashtags, post.id, setDrafts]);

  async function saveCopy() {
    setBusy("Saving…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}`, {
        method: "PATCH",
        body: { headline, copy, cta, hashtags: hashtags.split(/\s+/).filter(Boolean) },
      });
      setDirty(false);
      await onChange();
    } finally {
      setBusy("");
    }
  }

  async function regenerate() {
    setBusy("Regenerating copy…");
    try {
      await api(`/campaigns/${campaignId}/posts/${post.id}/regenerate`, { method: "POST", body: {} });
      await onChange();
    } finally {
      setBusy("");
    }
  }

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  return (
    <div className="post-copy">
      <div className="post-field">
        <span className="field-label small">Headline</span>
        <div className="relative">
          <Input className="pr-9" value={headline} onChange={(e) => mark(setHeadline)(e.target.value)} readOnly={!canEdit} />
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="headline" value={headline} onApply={(v) => mark(setHeadline)(v)} className="absolute right-1 top-1/2 -translate-y-1/2" />
          )}
        </div>
      </div>
      <div className="post-field">
        <span className="field-label small">
          Copy{" "}
          <span className={copy.length > limit ? "char-over" : "muted"}>
            {copy.length}/{limit}
          </span>
        </span>
        <TextareaZoom
          label="Copy"
          rows={6}
          value={copy}
          onChange={(v) => mark(setCopy)(v)}
          readOnly={!canEdit}
          footerSlot={
            canEdit ? (
              <AiAssist
                campaignId={campaignId}
                postId={post.id}
                field="copy"
                value={copy}
                onApply={(v) => mark(setCopy)(v)}
                label="Improve with AI"
              />
            ) : undefined
          }
        />
      </div>
      <div className="post-field">
        <span className="field-label small">Call to action</span>
        <div className="relative">
          <Input className="pr-9" value={cta} onChange={(e) => mark(setCta)(e.target.value)} readOnly={!canEdit} />
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="cta" value={cta} onApply={(v) => mark(setCta)(v)} className="absolute right-1 top-1/2 -translate-y-1/2" />
          )}
        </div>
      </div>
      <div className="post-field">
        <span className="field-label small">Hashtags</span>
        <div className="relative">
          <Input className="pr-9" value={hashtags} onChange={(e) => mark(setHashtags)(e.target.value)} readOnly={!canEdit} />
          {canEdit && (
            <AiAssist campaignId={campaignId} postId={post.id} field="hashtags" value={hashtags} onApply={(v) => mark(setHashtags)(v)} className="absolute right-1 top-1/2 -translate-y-1/2" />
          )}
        </div>
      </div>
      {post.rationale && <p className="post-hint">💡 {post.rationale}</p>}

      <div className="approval-bar">
        <span className={`tag approval-${post.approval_status}`}>
          {APPROVAL_LABELS[post.approval_status] ?? post.approval_status}
        </span>
        {post.approval_status === "rejected" && post.review_note && (
          <span className="muted small">— {post.review_note}</span>
        )}
        {canSubmit && (post.approval_status === "draft" || post.approval_status === "rejected") && (
          <Button variant="ghost" size="sm" onClick={() => review("submit")} disabled={!!busy}>
            Submit for review
          </Button>
        )}
        {canReview && post.approval_status !== "approved" && (
          <Button size="sm" onClick={() => review("approve")} disabled={!!busy}>
            Approve
          </Button>
        )}
        {canReview && post.approval_status === "pending_review" && (
          <Button variant="ghost" size="sm" onClick={() => review("reject")} disabled={!!busy}>
            Reject
          </Button>
        )}
        {ps && <PublishBadge ps={ps} busy={!!busy} />}
      </div>

      {post.best_time && (
        <p className="publish-suggestion">🕐 <strong>Suggested time:</strong> {post.best_time}</p>
      )}

      {canEdit && (
        <div className="form-actions">
          <Button size="sm" onClick={saveCopy} disabled={!dirty || !!busy}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={regenerate} disabled={!!busy}>
            Regenerate copy
          </Button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
      )}
    </div>
  );
}

function PublishBadge({ ps, busy }: { ps: PublishState; busy: boolean }) {
  if (ps.status === "published" || ps.status === "partial") {
    return (
      <span className="small" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span className="tag approval-approved">
          {ps.status === "partial" ? "⚠ Partially published" : "✓ Published"}
        </span>
        {ps.published_url && (
          <a href={ps.published_url} target="_blank" rel="noreferrer">
            View post ↗
          </a>
        )}
      </span>
    );
  }
  if (ps.status === "publishing") {
    return <span className="tag approval-pending_review">{busy ? "Publishing…" : "Publishing…"}</span>;
  }
  if (ps.status === "scheduled") {
    return (
      <span className="muted small">
        ⏰ Scheduled{ps.scheduled_at ? ` for ${new Date(ps.scheduled_at).toLocaleString()}` : ""}
      </span>
    );
  }
  if (ps.status === "failed") {
    return (
      <span className="char-over small" title={ps.error}>
        ✗ Failed{ps.error ? `: ${ps.error.slice(0, 120)}` : ""}
      </span>
    );
  }
  return null;
}

const APPROVAL_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function ratioRank(r: string): number {
  const i = RATIO_PRIORITY.indexOf(r);
  return i === -1 ? RATIO_PRIORITY.length : i;
}

// Radix Select forbids an empty-string item value, so the "Default model"
// option uses a sentinel that maps back to "" (= use the system default).
const DEFAULT_MODEL = "__default__";

function ModelSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; display_name: string }[];
}) {
  return (
    <Select
      value={value || DEFAULT_MODEL}
      onValueChange={(v) => onChange(v === DEFAULT_MODEL ? "" : v)}
    >
      <SelectTrigger size="sm" className="w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
        {options.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function statusDot(item?: { status: string; base_object_key: string }) {
  if (!item) return null;
  if (item.status === "generating") return <span className="ratio-dot busy" />;
  if (item.status === "ready" && item.base_object_key) return <span className="ratio-dot ok" />;
  return null;
}

/** One element = one visual concept. Carousels have several slides (slot_index),
 *  each with its own prompt; within a slide, the ratio variants are auto-derived
 *  from the base ratio. So we navigate slides first, then ratios. */
function ElementVisual({
  campaignId,
  images,
  client,
  models,
  canEdit,
  onChange,
  platformsForRatio,
}: {
  campaignId: string;
  images: PostImage[];
  client: Client | null;
  models: ImageModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
  platformsForRatio: (ratio: string) => string[];
}) {
  const slots = Array.from(new Set(images.map((i) => i.slot_index))).sort((a, b) => a - b);
  const isCarousel = slots.length > 1;
  const [slot, setSlot] = useState(slots[0] ?? 0);

  const slotImages = images
    .filter((i) => i.slot_index === (slots.includes(slot) ? slot : slots[0]))
    .sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio));
  const primaryId = slotImages[0]?.id;
  const [selId, setSelId] = useState(primaryId);
  const current = slotImages.find((i) => i.id === selId) ?? slotImages[0];
  // While any ratio of this slide is generating, lock generation on all of them —
  // one base generation drives the rest, so a rival generation must be blocked.
  const slotBusy = slotImages.some((i) => i.status === "generating");

  useEffect(() => {
    if (!slotImages.some((i) => i.id === selId)) setSelId(primaryId);
  }, [slotImages, selId, primaryId]);

  if (!current) return null;
  return (
    <div className="element-visual">
      {isCarousel && (
        <div className="ratio-switch slide-switch">
          {slots.map((s, idx) => {
            const slotPrimary = images
              .filter((i) => i.slot_index === s)
              .sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio))[0];
            return (
              <button
                key={s}
                className={`ratio-tab ${s === slot ? "active" : ""}`}
                onClick={() => setSlot(s)}
              >
                Slide {idx + 1}
                {statusDot(slotPrimary)}
              </button>
            );
          })}
        </div>
      )}
      {slotImages.length > 1 && (
        <div className="ratio-switch">
          {slotImages.map((img) => (
            <button
              key={img.id}
              className={`ratio-tab ${img.id === selId ? "active" : ""}`}
              onClick={() => setSelId(img.id)}
              title={img.id === primaryId ? "Base ratio" : "Derived from the base ratio"}
            >
              {img.aspect_ratio}
              {statusDot(img)}
            </button>
          ))}
        </div>
      )}
      <p className="muted small ratio-platforms">
        <span className="ratio-pill">{current.aspect_ratio}</span>
        {platformsForRatio(current.aspect_ratio).length
          ? platformsForRatio(current.aspect_ratio).map((p) => <PlatformIcon key={p} platform={p} size={14} />)
          : "all"}
      </p>
      <ImageSlot
        key={current.id}
        campaignId={campaignId}
        image={current}
        client={client}
        models={models}
        canEdit={canEdit}
        onChange={onChange}
        cascades={current.id === primaryId && slotImages.length > 1}
        lockGenerate={slotBusy}
      />
    </div>
  );
}

function ImageSlot({
  campaignId,
  image,
  client,
  models,
  canEdit,
  onChange,
  cascades = false,
  lockGenerate = false,
}: {
  campaignId: string;
  image: PostImage;
  client: Client | null;
  models: ImageModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
  cascades?: boolean;
  lockGenerate?: boolean;
}) {
  const [prompt, setPrompt] = useState(image.prompt);
  const [negative, setNegative] = useState(image.negative_prompt);
  const [guidance, setGuidance] = useState(image.additional_guidance);
  const [modelId, setModelId] = useState(image.image_model_id ?? "");
  // Surface the prompt before the first generation so it can be tuned upfront.
  // Generation prompts are always visible in the editor (no toggle).
  const [editorOpen, setEditorOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { preview, full } = useImageUrl(campaignId, image);

  async function savePrompt() {
    await api(`/campaigns/${campaignId}/images/${image.id}/prompt`, {
      method: "PATCH",
      body: { prompt, negative_prompt: negative, additional_guidance: guidance },
    });
    await onChange();
  }

  async function generate() {
    setBusy("Queuing…");
    setError("");
    try {
      if (prompt !== image.prompt || negative !== image.negative_prompt || guidance !== image.additional_guidance) {
        await savePrompt();
      }
      // Generation runs in a background worker; the page polls while it runs,
      // so navigating away never interrupts it.
      await api(`/campaigns/${campaignId}/images/${image.id}/generate`, {
        method: "POST",
        body: { image_model_id: modelId || null },
      });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setBusy("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/campaigns/${campaignId}/images/${image.id}/upload`, { method: "POST", formData: fd });
      await onChange();
    } finally {
      setBusy("");
    }
  }

  async function download() {
    setBusy("Preparing…");
    setError("");
    try {
      // The composite endpoint renders the final PNG (base + logo + layers + text).
      const name = `image-${image.aspect_ratio.replace(":", "x")}.png`;
      await downloadFile(`/campaigns/${campaignId}/images/${image.id}/composite`, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  const logoOn = (image.canvas_state?.logo_enabled ?? true) !== false;
  async function toggleLogo() {
    setBusy("Updating…");
    setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/logo`, {
        method: "PATCH",
        body: { enabled: !logoOn },
      });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update logo");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="image-slot">
      <div className="image-thumb" style={{ aspectRatio: image.aspect_ratio.replace(":", "/") }}>
        {image.status === "generating" ? (
          <MediaSkeleton loading label="Generating image…" />
        ) : preview ? (
          <img src={preview} alt="post" className="image-zoomable" onClick={() => setLightbox(true)} />
        ) : image.base_object_key ? (
          // Generated already — the blob is still downloading.
          <MediaSkeleton loading label="Loading…" />
        ) : (
          <MediaSkeleton label="No image yet" />
        )}
        {preview && image.status !== "generating" && (
          <div className="image-overlay">
            <button className="icon-btn" title="View full size" onClick={() => setLightbox(true)}>
              <Maximize2 size={18} />
            </button>
            {canEdit && image.base_object_key && (
              <button className="icon-btn" title="Edit image" onClick={() => setEditorOpen(true)}>
                <Pencil size={18} />
              </button>
            )}
            <button className="icon-btn" title="Download image" onClick={download} disabled={!!busy}>
              <Download size={18} />
            </button>
          </div>
        )}
        {busy && <div className="image-busy">{busy}</div>}
      </div>
      {lightbox && preview && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <button className="lightbox-close icon-btn" title="Close" onClick={() => setLightbox(false)}>
            <X size={20} />
          </button>
          <img src={full || preview} alt="full size" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      <div className="image-meta small muted">
        <span className="ratio-pill">{image.aspect_ratio}</span>
        {image.status === "failed" && <span className="tag tag-red">failed</span>}
      </div>
      {(error || image.error) && <div className="alert alert-error small">{error || image.error}</div>}

      {canEdit && (
        <div className="image-actions">
          <ModelSelect value={modelId} onChange={setModelId} options={models} />
          <Button
            size="sm"
            onClick={generate}
            disabled={!!busy || image.status === "generating" || lockGenerate}
            title={lockGenerate && image.status !== "generating" ? "The base ratio is generating — it will create this one too" : undefined}
          >
            <Sparkles size={14} />
            {image.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : image.base_object_key ? "Regenerate" : "Generate"}
          </Button>
          <Button asChild variant="ghost" size="sm" className={lockGenerate ? "pointer-events-none opacity-50" : ""}>
            <label className="file-btn">
              <UploadIcon size={14} /> Upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={!!busy || lockGenerate}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
          </Button>
          {client?.logo_object_key && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLogo}
              disabled={!!busy}
              title="Include the brand logo in the generated image (applied next time you generate)"
            >
              {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
            </Button>
          )}
        </div>
      )}
      {canEdit && cascades && (
        <p className="muted small cascade-note">
          <Sparkles size={12} /> Generating this base also creates the other ratios automatically.
        </p>
      )}

      {canEdit && (
        <div className="prompt-editor">
          <label className="small">
            Image prompt
            <TextareaZoom label="Image prompt" rows={4} value={prompt} onChange={setPrompt} />
          </label>
          <label className="small">
            Negative prompt
            <TextareaZoom label="Negative prompt" rows={2} value={negative} onChange={setNegative} />
          </label>
          <label className="small">
            Additional guidance (appended)
            <Input value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </label>
          <div className="form-actions">
            <Button variant="ghost" size="sm" onClick={savePrompt}>
              Save prompt
            </Button>
            {image.prompt_history.length > 0 && (
              <span className="muted small">{image.prompt_history.length} previous version(s)</span>
            )}
          </div>
        </div>
      )}

      {editorOpen && client && (
        <ImageEditor
          campaignId={campaignId}
          image={image}
          client={client}
          onClose={() => setEditorOpen(false)}
          onSaved={onChange}
        />
      )}
    </div>
  );
}

/** Videos of an element grouped by ratio (same presentation as images). The base
 *  ratio is generated; the rest are reframed from it on demand (manual, for cost). */
function VideoVisual({
  campaignId,
  videos,
  client,
  models,
  canEdit,
  onChange,
  platformsForRatio,
}: {
  campaignId: string;
  videos: PostVideo[];
  client: Client | null;
  models: VideoModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
  platformsForRatio: (ratio: string) => string[];
}) {
  const ordered = [...videos].sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio));
  const primaryId = ordered[0]?.id;
  const [selId, setSelId] = useState(primaryId);
  const current = ordered.find((v) => v.id === selId) ?? ordered[0];
  useEffect(() => {
    if (!ordered.some((v) => v.id === selId)) setSelId(primaryId);
  }, [ordered, selId, primaryId]);
  const slotBusy = ordered.some((v) => v.status === "generating");
  if (!current) return null;
  return (
    <div className="element-visual">
      {ordered.length > 1 && (
        <div className="ratio-switch">
          {ordered.map((v) => (
            <button
              key={v.id}
              className={`ratio-tab ${v.id === selId ? "active" : ""}`}
              onClick={() => setSelId(v.id)}
              title={v.id === primaryId ? "Base ratio" : "Reframed from the base ratio"}
            >
              {v.aspect_ratio}
              {statusDot(v)}
            </button>
          ))}
        </div>
      )}
      <p className="muted small ratio-platforms">
        <span className="ratio-pill">{current.aspect_ratio}</span>
        {platformsForRatio(current.aspect_ratio).length
          ? platformsForRatio(current.aspect_ratio).map((p) => <PlatformIcon key={p} platform={p} size={14} />)
          : "all"}
      </p>
      <VideoSlot
        key={current.id}
        campaignId={campaignId}
        video={current}
        client={client}
        models={models}
        canEdit={canEdit}
        onChange={onChange}
        isPrimary={current.id === primaryId}
        hasSiblings={ordered.length > 1}
        lockGenerate={slotBusy}
      />
    </div>
  );
}

function VideoSlot({
  campaignId,
  video,
  client,
  models,
  canEdit,
  onChange,
  isPrimary = false,
  hasSiblings = false,
  lockGenerate = false,
}: {
  campaignId: string;
  video: PostVideo;
  client?: Client | null;
  models: VideoModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
  isPrimary?: boolean;
  hasSiblings?: boolean;
  lockGenerate?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState(video.prompt);
  const [negative, setNegative] = useState(video.negative_prompt);
  const [modelId, setModelId] = useState(video.video_model_id ?? "");
  // Surface the prompt before the first generation so it can be tuned upfront.
  // Generation prompts are always visible in the editor (no toggle).
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPrompt(video.prompt);
    setNegative(video.negative_prompt);
  }, [video.prompt, video.negative_prompt]);

  // Load the video file once it's ready (or replaced).
  useEffect(() => {
    if (!video.base_object_key || video.status !== "ready") {
      setUrl("");
      return;
    }
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}`).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [campaignId, video.id, video.base_object_key, video.status]);

  async function savePrompt() {
    await api(`/campaigns/${campaignId}/videos/${video.id}/prompt`, {
      method: "PATCH",
      body: { prompt, negative_prompt: negative },
    });
    await onChange();
  }

  async function generate() {
    setBusy("Queuing…");
    setError("");
    try {
      if (prompt !== video.prompt || negative !== video.negative_prompt) await savePrompt();
      await api(`/campaigns/${campaignId}/videos/${video.id}/generate`, {
        method: "POST",
        body: { video_model_id: modelId || null },
      });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setBusy("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/campaigns/${campaignId}/videos/${video.id}/upload`, { method: "POST", formData: fd });
      await onChange();
    } finally {
      setBusy("");
    }
  }

  const logoOn = (video.logo_enabled ?? true) !== false;
  async function toggleLogo() {
    setBusy("Updating…");
    setError("");
    try {
      await api(`/campaigns/${campaignId}/videos/${video.id}/logo`, { method: "PATCH", body: { enabled: !logoOn } });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update logo");
    } finally {
      setBusy("");
    }
  }

  async function deriveVariants() {
    setBusy("Queuing variants…");
    setError("");
    try {
      await api(`/campaigns/${campaignId}/videos/${video.id}/derive-ratios`, { method: "POST" });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate variants");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="image-slot video-slot">
      <div className="image-thumb" style={{ aspectRatio: video.aspect_ratio.replace(":", "/") }}>
        {video.status === "generating" ? (
          <MediaSkeleton kind="video" loading label="Generating video…" />
        ) : url ? (
          <video src={url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : video.base_object_key && video.status === "ready" ? (
          <MediaSkeleton kind="video" loading label="Loading…" />
        ) : (
          <MediaSkeleton kind="video" label="No video yet" />
        )}
        {busy && <div className="image-busy">{busy}</div>}
      </div>
      <div className="image-meta small muted">
        Video · {video.aspect_ratio} · {video.duration_seconds}s
        {video.status === "failed" && <span className="tag tag-red"> failed</span>}
      </div>
      {(error || video.error) && <div className="alert alert-error small">{error || video.error}</div>}

      {canEdit && (
        <div className="image-actions">
          {isPrimary ? (
            <>
              <ModelSelect value={modelId} onChange={setModelId} options={models} />
              <Button
                size="sm"
                onClick={generate}
                disabled={!!busy || video.status === "generating" || lockGenerate}
              >
                <Sparkles size={14} />
                {video.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : video.base_object_key ? "Regenerate" : "Generate"}
              </Button>
              {client?.logo_object_key && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleLogo}
                  disabled={!!busy}
                  title="Overlay the brand logo on the video (applied next time you generate)"
                >
                  {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
                </Button>
              )}
              {hasSiblings && video.base_object_key && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={deriveVariants}
                  disabled={!!busy || lockGenerate}
                  title="Reframe this base video into the other aspect ratios"
                >
                  <Sparkles size={14} /> Generate other ratios
                </Button>
              )}
            </>
          ) : (
            <span className="muted small">↳ Reframed from the base ratio</span>
          )}
          <Button asChild variant="ghost" size="sm" className={lockGenerate ? "pointer-events-none opacity-50" : ""}>
            <label className="file-btn">
              <UploadIcon size={14} /> Upload
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                hidden
                disabled={!!busy || lockGenerate}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
          </Button>
        </div>
      )}

      {canEdit && isPrimary && (
        <div className="prompt-editor">
          <label className="small">
            Video prompt
            <TextareaZoom label="Video prompt" rows={4} value={prompt} onChange={setPrompt} />
          </label>
          <label className="small">
            Negative prompt
            <TextareaZoom label="Negative prompt" rows={2} value={negative} onChange={setNegative} />
          </label>
          <div className="form-actions">
            <Button variant="ghost" size="sm" onClick={savePrompt}>
              Save prompt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
