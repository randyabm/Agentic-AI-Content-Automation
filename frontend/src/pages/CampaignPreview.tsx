import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Send } from "lucide-react";
import { api } from "../api";
import { getBlobUrl } from "../lib/blobCache";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { WorkflowStepper } from "../components/WorkflowStepper";
import { SendForApprovalModal } from "../components/SendForApprovalModal";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth";
import type { CampaignDetail as Campaign, CampaignElement, Post } from "../types";
import { cn } from "@/lib/utils";

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

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (!campaign) return <div className="py-12 text-center text-muted-foreground">Campaign not found</div>;

  const posts = campaign.posts ?? [];
  const platforms = Array.from(new Set(posts.map((p) => p.platform)));

  const canSubmit =
    user?.org_role === "analyst" ||
    user?.org_role === "creative" ||
    user?.org_role === "reviewer" ||
    user?.org_role === "org_admin";

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

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {[...campaign.elements]
          .sort((a, b) => a.position - b.position)
          .map((el) => (
            <ElementPreviewCard
              key={el.id}
              campaignId={campaign.id}
              element={el}
              posts={posts.filter((p) => p.element_id === el.id)}
            />
          ))}
        {campaign.elements.length === 0 && <p className="text-muted-foreground">No elements in this campaign yet.</p>}
      </div>

      <WorkflowStepper currentStep="preview" />

      <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">Preview Mode</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}`)}>
            Back to Edit
          </Button>
          {canSubmit && (
            <Button onClick={() => setShowApproval(true)}>
              <Send size={14} className="mr-1" /> Send for Approval
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

function ElementPreviewCard({
  campaignId,
  element,
  posts,
}: {
  campaignId: string;
  element: CampaignElement;
  posts: Post[];
}) {
  const cover = element.images.find((i) => i.base_object_key) ?? null;
  const coverVideo = element.videos.find((v) => v.base_object_key && v.status === "ready") ?? null;
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
    if (cover?.base_object_key || !coverVideo?.base_object_key) return;
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${coverVideo.id}/file?v=${coverVideo.base_object_key}`)
      .then((u) => {
        if (active) setVideoUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [campaignId, cover?.base_object_key, coverVideo?.id, coverVideo?.base_object_key]);

  const ratios = Array.from(
    new Set([...element.images.map((i) => i.aspect_ratio), ...element.videos.map((v) => v.aspect_ratio)]),
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

  const scheduledCount = posts.filter((p) => p.publish_state?.status === "scheduled").length;
  const publishedCount = posts.filter(
    (p) => p.publish_state?.status === "published",
  ).length;

  return (
    <div className="cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : videoUrl ? (
          <video src={videoUrl} muted playsInline preload="metadata" />
        ) : element.element_type === "text" ? (
          <div className="p-8 text-sm text-muted-foreground">Text only</div>
        ) : (
          <div className="p-8 text-sm text-muted-foreground">
            {videoCount > 0 && element.images.length === 0 ? "🎬 No video yet" : "No image yet"}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <strong className="line-clamp-2 text-sm font-semibold">{headline}</strong>
        <div className="flex flex-wrap gap-1">
          {element.platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-full border border-primary-soft-border bg-accent px-2 py-0.5 text-[0.7rem] font-medium capitalize text-primary"
            >
              <PlatformIcon platform={p} size={12} /> {p}
            </span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">{meta.join(" · ")}</div>
        {(scheduledCount > 0 || publishedCount > 0) && (
          <div className={cn("flex flex-wrap gap-1")} style={{ marginTop: 4 }}>
            {scheduledCount > 0 && (
              <span className="inline-block rounded-full border border-primary-soft-border bg-accent px-2.5 py-0.5 text-xs font-medium text-primary">
                ⏰ {scheduledCount} scheduled
              </span>
            )}
            {publishedCount > 0 && (
              <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                ✅ {publishedCount} published
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
