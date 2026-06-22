import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getBlobUrl } from "../lib/blobCache";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { WorkflowStepper } from "../components/WorkflowStepper";
import { Button } from "@/components/ui/button";
import type { CampaignDetail as Campaign, CampaignElement, Post, PostImage } from "../types";

export default function CampaignPreview() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) return;
    api<Campaign>(`/campaigns/${campaignId}`)
      .then((c) => {
        setCampaign(c);
        api<{ company_name: string }>(`/clients/${c.client_id}`)
          .then((cl) => setClientName(cl.company_name))
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!campaign) return <div className="page-loading">Campaign not found</div>;

  const posts = campaign.posts ?? [];
  const platforms = Array.from(new Set(posts.map((p) => p.platform)));

  return (
    <div>
      <div className="page-header">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/campaigns/${campaignId}`)}>
            ← Back to Editor
          </Button>
          <h1 style={{ marginTop: "0.5rem" }}>Preview: {campaign.name}</h1>
          <p className="muted small">Review your campaign assets and schedule before final submission.</p>
        </div>
      </div>

      {/* Summary card */}
      <div
        className="card p-lg"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          borderRadius: "12px",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <p className="text-label-md text-[#4a4455] uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Client</p>
          <p className="font-semibold" style={{ fontSize: "0.95rem", color: "#6d28d9" }}>{clientName}</p>
        </div>
        <div>
          <p className="text-label-md text-[#4a4455] uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Goal</p>
          <p className="font-semibold" style={{ fontSize: "0.95rem", color: "#6d28d9" }}>{campaign.objective}</p>
        </div>
        <div>
          <p className="text-label-md text-[#4a4455] uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Platforms</p>
          <div className="flex gap-2 mt-1">
            {platforms.map((p) => (
              <span key={p} className="px-3 py-1 bg-[#e1e8fd] rounded-full text-label-md font-bold flex items-center gap-1" style={{ fontSize: "0.75rem" }}>
                <PlatformIcon platform={p} size={12} /> {platformLabel(p)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-label-md text-[#4a4455] uppercase tracking-wider" style={{ fontSize: "0.7rem" }}>Dates</p>
          <p className="font-semibold" style={{ fontSize: "0.95rem" }}>
            {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : "—"} - {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      {/* Posts Grid */}
      <div
        className="card-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {posts.map((post) => (
          <PostPreviewCard key={post.id} campaignId={campaign.id} post={post} posts={posts} />
        ))}
        {posts.length === 0 && <p className="muted">No posts in this campaign yet.</p>}
      </div>

      {/* Workflow stepper */}
      <WorkflowStepper currentStep="preview" />

      {/* Actions */}
      <div
        className="card p-md"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "1.5rem",
          borderRadius: "12px",
        }}
      >
        <div>
          <p className="text-label-sm text-[#4a4455]">Preview Mode</p>
        </div>
        <div className="flex gap-md">
          <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}`)}>
            Back to Edit
          </Button>
          <Button onClick={() => navigate(`/campaigns/${campaignId}`)} style={{ background: "#6d28d9" }}>
            Send for Approval
          </Button>
        </div>
      </div>
    </div>
  );
}

function PostPreviewCard({ campaignId, post, posts: _posts }: { campaignId: string; post: Post; posts: Post[] }) {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    const image = findPostImage(post, _posts);
    if (image?.base_object_key) {
      getBlobUrl(`/campaigns/${campaignId}/images/${image.id}/display`).then(setImageUrl).catch(() => {});
    }
  }, [campaignId, post, _posts]);

  const iconMap: Record<string, string> = {
    instagram: "photo_camera",
    facebook: "thumb_up",
    linkedin: "work",
    tiktok: "music_note",
    x: "chat_bubble",
    twitter: "chat_bubble",
    youtube: "play_circle",
  };

  const colorMap: Record<string, string> = {
    instagram: "from-yellow-400 via-red-500 to-purple-600",
    facebook: "bg-blue-600",
    linkedin: "bg-[#0077B5]",
    tiktok: "bg-black",
    x: "bg-black",
    twitter: "bg-black",
    youtube: "bg-red-600",
  };

  const icon = iconMap[post.platform] ?? "post";
  const color = colorMap[post.platform] ?? "bg-gray-500";

  return (
    <div className="card overflow-hidden" style={{ borderRadius: "12px" }}>
      <div className="p-md flex items-center justify-between" style={{ background: "#f1f3ff" }}>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white`}>
            <span className="material-symbols-outlined text-sm">{icon}</span>
          </div>
          <span className="font-bold text-label-md">{platformLabel(post.platform)}</span>
        </div>
        {post.best_time && <span className="text-label-sm text-[#4a4455]">{post.best_time}</span>}
      </div>
      <div className="aspect-square bg-[#dce2f7] relative overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt="post" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#4a4455] opacity-40">
            <span className="material-symbols-outlined text-4xl">image</span>
          </div>
        )}
      </div>
      <div className="p-md">
        {post.headline && <p className="font-bold text-body-md mb-1">{post.headline}</p>}
        <p className="text-body-md text-[#4a4455]" style={{ fontSize: "0.8rem" }}>
          {post.copy?.slice(0, 120)}{post.copy?.length > 120 ? "…" : ""}
        </p>
        {post.hashtags?.length > 0 && (
          <p className="text-[#6d28d9] text-label-sm mt-2" style={{ fontSize: "0.75rem" }}>
            {post.hashtags.slice(0, 5).join(" ")}
          </p>
        )}
      </div>
    </div>
  );
}

function findPostImage(post: Post, posts: Post[]): PostImage | null {
  const elementId = post.element_id;
  if (!elementId) return null;
  const sibling = posts.find((p) => p.element_id === elementId);
  if (!sibling) return null;
  return null; // Images are loaded from element data, not posts
}
