import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CalendarDays, ChevronRight, FileImage, Film, Layers, Rocket, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { AiAssist } from "../../components/AiAssist";
import { TextareaZoom } from "../../components/TextareaZoom";
import { PlatformIcon, platformLabel } from "../../components/PlatformIcon";
import { LivePreviewColumn, type PreviewDraft } from "../../components/PostPreview";
import BlockedReasonBadge from "../../components/BlockedReasonBadge";
import { useConfirm, usePrompt } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { CampaignElement, Client, ImageModel, Post, PublishState, VideoModel } from "../../types";
import { ElementVisual } from "./ImageSlots";
import { VideoVisual } from "./VideoSlots";

const PLATFORM_LIMITS: Record<string, number> = {
  facebook: 63206, instagram: 2200, linkedin: 3000, tiktok: 2200, x: 280, youtube: 5000,
};

// Post-level 3-field model: the badge reflects the approval gate, falling back
// to the content stage when the gate is idle (pending on an unsubmitted draft
// or a post sent back for changes).
type BadgeVariant = "secondary" | "warning" | "success" | "destructive";
function postStatusBadge(post: Post): { label: string; variant: BadgeVariant } {
  if (post.approval_status === "approved") return { label: "Approved", variant: "success" };
  if (post.approval_status === "not_required") return { label: "No approval needed", variant: "secondary" };
  if (post.approval_status === "rejected") return { label: "Rejected", variant: "destructive" };
  // pending gate: distinguish submitted-and-waiting from still-being-edited
  if (post.content_status === "ready_for_review") return { label: "Pending review", variant: "warning" };
  if (post.content_status === "changes_requested") return { label: "Changes requested", variant: "warning" };
  return { label: "Draft", variant: "secondary" };
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

export function ElementModal({ campaignId, element, posts, client, models, videoModels, canEdit, onChange, onClose, previewOnly = false }: { campaignId: string; element: CampaignElement | null; posts: Post[]; client: Client | null; models: ImageModel[]; videoModels: VideoModel[]; canEdit: boolean; onChange: () => Promise<void>; onClose: () => void; previewOnly?: boolean }) {
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
        className={cn("flex max-h-[94vh] flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-black/5", previewOnly ? "w-[min(96vw,560px)]" : "w-[min(96vw,1180px)]")}
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

        {previewOnly ? (
          <div className="flex-1 overflow-y-auto p-5">
            {showPreview ? (
              <LivePreviewColumn campaignId={campaignId} element={element!} posts={posts} client={client!} drafts={drafts} activePlatform={tab} />
            ) : (
              <p className="text-sm text-muted-foreground">Preview isn't available for this element yet.</p>
            )}
          </div>
        ) : (
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
        )}
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
  const isCleared = post.approval_status === "approved" || post.approval_status === "not_required";
  const canPublishNow = isCleared
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
          {(() => {
            const b = postStatusBadge(post);
            return <Badge variant={b.variant}>{b.label}</Badge>;
          })()}
          {ps && <PublishBadge ps={ps} busy={!!busy} />}
          {post.best_time && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays size={12} /> Suggested: <strong className="font-medium text-foreground/80">{post.best_time}</strong>
            </span>
          )}
        </div>
        {(post.approval_status === "rejected" || post.content_status === "changes_requested")
          && (post.rejection_comment || post.review_note) && (
          <p className="m-0 rounded-md border-l-[3px] border-red-500 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {post.rejection_comment || post.review_note}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit
            && (post.content_status === "draft" || post.content_status === "changes_requested")
            && post.approval_status !== "approved" && post.approval_status !== "not_required" && (
            <Button variant="outline" size="sm" onClick={() => review("submit")} disabled={!!busy}>
              Submit for review
            </Button>
          )}
          {canReview && post.approval_status === "pending" && post.content_status === "ready_for_review" && (
            <Button size="sm" onClick={() => review("approve")} disabled={!!busy}>
              Approve
            </Button>
          )}
          {canReview && post.approval_status === "pending" && post.content_status === "ready_for_review" && (
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
