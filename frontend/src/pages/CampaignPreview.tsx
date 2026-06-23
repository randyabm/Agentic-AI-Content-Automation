import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getBlobUrl } from "../lib/blobCache";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { WorkflowStepper } from "../components/WorkflowStepper";
import { SendForApprovalModal } from "../components/SendForApprovalModal";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth";
import type { CampaignDetail as Campaign, CampaignElement, ElementType, Post, PostImage, PostVideo } from "../types";

export default function CampaignPreview() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);
  const [showApproval, setShowApproval] = useState(false);

  async function load() {
    if (!campaignId) return;
    const c = await api<Campaign>(`/campaigns/${campaignId}`);
    setCampaign(c);
    api<{ company_name: string }>(`/clients/${c.client_id}`)
      .then((cl) => setClientName(cl.company_name))
      .catch(() => {});
  }

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!campaign) return <div className="page-loading">Campaign not found</div>;

  const posts = campaign.posts ?? [];
  const platforms = Array.from(new Set(posts.map((p) => p.platform)));

  const canSubmit =
    user?.org_role === "analyst" ||
    user?.org_role === "creative" ||
    user?.org_role === "reviewer" ||
    user?.org_role === "org_admin";

  // Resolve each post's element (posts don't carry images/videos directly).
  function elFor(post: Post): CampaignElement | null {
    if (!post.element_id) return null;
    return campaign!.elements.find((e) => e.id === post.element_id) ?? null;
  }

  return (
    <div>
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/campaigns/${campaignId}`)}>
          ← Back to Editor
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Preview: {campaign.name}</h1>
        <p className="text-sm text-muted-foreground">
          Review your campaign assets and schedule before final submission.
        </p>
      </div>

      {/* Summary card */}
      <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Client</p>
          <p className="text-sm font-semibold text-primary">{clientName || "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Goal</p>
          <p className="text-sm font-semibold capitalize text-primary">{campaign.objective}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Platforms</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {platforms.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground"
              >
                <PlatformIcon platform={p} size={12} /> {platformLabel(p)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Dates</p>
          <p className="text-sm font-semibold">
            {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : "—"} –{" "}
            {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      {/* Posts grid */}
      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {posts.map((post) => {
          const el = elFor(post);
          return (
            <PostPreviewCard
              key={post.id}
              campaignId={campaign.id}
              post={post}
              cover={el?.images.find((i) => i.base_object_key) ?? null}
              coverVid={el?.videos.find((v) => v.base_object_key && v.status === "ready") ?? null}
              elementType={el?.element_type}
            />
          );
        })}
        {posts.length === 0 && <p className="text-muted-foreground">No posts in this campaign yet.</p>}
      </div>

      {/* Workflow stepper */}
      <WorkflowStepper currentStep="preview" />

      {/* Actions */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">Preview Mode</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}`)}>
            Back to Edit
          </Button>
          {canSubmit && (
            <Button onClick={() => setShowApproval(true)}>
              <span className="material-symbols-outlined mr-1 text-base">send</span> Send for Approval
            </Button>
          )}
        </div>
      </div>

      {showApproval && campaignId && (
        <SendForApprovalModal
          campaignId={campaignId}
          onClose={() => setShowApproval(false)}
          onDone={async () => {
            navigate(`/campaigns/${campaignId}`);
          }}
        />
      )}
    </div>
  );
}

function PostPreviewCard({
  campaignId,
  post,
  cover,
  coverVid,
  elementType,
}: {
  campaignId: string;
  post: Post;
  cover: PostImage | null;
  coverVid: PostVideo | null;
  elementType?: ElementType;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    if (!cover?.base_object_key) return;
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/images/${cover.id}/display`)
      .then((u) => {
        if (active) setImageUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [campaignId, cover?.id, cover?.base_object_key]);

  useEffect(() => {
    if (cover?.base_object_key || !coverVid?.base_object_key) return;
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${coverVid.id}/file?v=${coverVid.base_object_key}`)
      .then((u) => {
        if (active) setVideoUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [campaignId, cover?.base_object_key, coverVid?.id, coverVid?.base_object_key]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between bg-accent px-4 py-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={post.platform} size={18} />
          <span className="text-sm font-bold">{platformLabel(post.platform)}</span>
        </div>
        {post.publish_state?.status === "scheduled" && post.publish_state.scheduled_at ? (
          <span className="text-xs font-medium text-foreground">
            {new Date(post.publish_state.scheduled_at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : (
          post.best_time && <span className="text-xs text-muted-foreground">{post.best_time}</span>
        )}
      </div>
      <div className="relative aspect-square overflow-hidden bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="post" className="size-full object-cover" loading="lazy" />
        ) : videoUrl ? (
          <video src={videoUrl} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : elementType === "text" ? (
          <div className="flex size-full items-center justify-center bg-accent p-5">
            <p className="line-clamp-5 text-center text-sm font-medium leading-snug text-accent-foreground">
              {post.headline || post.copy || "Text post"}
            </p>
          </div>
        ) : elementType === "video" ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground/50">
            <span className="material-symbols-outlined text-4xl">movie</span>
            <span className="text-xs font-medium uppercase tracking-wider">Reel</span>
          </div>
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <span className="material-symbols-outlined text-4xl">image</span>
          </div>
        )}
      </div>
      <div className="p-4">
        {post.headline && <p className="mb-1 text-sm font-bold">{post.headline}</p>}
        <p className="text-sm text-muted-foreground">
          {post.copy?.slice(0, 120)}
          {post.copy && post.copy.length > 120 ? "…" : ""}
        </p>
        {post.hashtags?.length > 0 && (
          <p className="mt-2 text-xs text-primary">{post.hashtags.slice(0, 5).join(" ")}</p>
        )}
      </div>
    </div>
  );
}
