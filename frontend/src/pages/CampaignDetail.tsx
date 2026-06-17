import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, Eye, EyeOff, Maximize2, Pencil, Sparkles, Type, Upload as UploadIcon, X } from "lucide-react";
import { api, apiBlob, downloadFile } from "../api";
import { ImageEditor } from "../components/ImageEditor";
import { TextareaZoom } from "../components/TextareaZoom";
import { PlatformIcon } from "../components/PlatformIcon";
import { PostPreviewModal } from "../components/PostPreview";
import { RATIO_PRIORITY } from "../ratios";
import { useAuth } from "../auth";
import type {
  CampaignDetail as Campaign,
  CampaignElement,
  Client,
  ImageModel,
  Post,
  PostImage,
  PostVideo,
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
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [openElementId, setOpenElementId] = useState<string | null>(null);

  const canEdit = user?.role === "admin" || user?.role === "editor";

  async function load() {
    const c = await api<Campaign>(`/campaigns/${campaignId}`);
    setCampaign(c);
    if (!client) api<Client>(`/clients/${c.client_id}`).then(setClient).catch(() => {});
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ImageModel[]>("/image-models").then(setModels).catch(() => {});
    api<VideoModel[]>("/video-models").then(setVideoModels).catch(() => {});
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
    if (!window.confirm("Delete this campaign permanently?")) return;
    await api(`/campaigns/${campaign!.id}`, { method: "DELETE" });
    navigate("/campaigns");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost" onClick={() => navigate("/campaigns")}>
            ← Campaigns
          </button>
          <h1 style={{ marginTop: "0.5rem" }}>{campaign.name}</h1>
          <p className="muted small">
            {client?.company_name} · {campaign.objective} ·{" "}
            <span className={`tag ${campaign.status === "ready" ? "tag-green" : campaign.status === "failed" ? "tag-red" : "tag"}`}>
              {campaign.status}
            </span>
          </p>
        </div>
        {canEdit && (
          <div className="competitor-actions">
            <button className="btn btn-ghost" onClick={regenerateAll} disabled={!!busy || campaign.status === "generating"}>
              Regenerate all
            </button>
            <button className="btn btn-ghost danger" onClick={remove}>
              Delete
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {campaign.status === "failed" && <div className="alert alert-error">{campaign.error}</div>}
      {busy && <div className="alert alert-success">{busy}</div>}

      {campaign.status === "generating" && (
        <div className="card progress-card">
          <strong>Generating campaign…</strong>
          <div className="progress-bar">
            <div className="progress-fill indeterminate" />
          </div>
          <p className="muted small">The Editorial and Visual agents are working. This can take a minute.</p>
        </div>
      )}

      {campaign.status === "ready" && (
        <div className="card export-bar">
          <strong>Export:</strong>
          {(["zip", "pdf", "json", "csv"] as const).map((fmt) => (
            <button
              key={fmt}
              className="btn btn-ghost"
              onClick={() => downloadFile(`/campaigns/${campaign.id}/export?format=${fmt}`, `campaign_${campaign.id}.${fmt}`)}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}


      {/* Hide the element cards while the campaign is still generating — they'd
          just show empty "No image yet" placeholders, which looks unfinished. */}
      {campaign.status !== "generating" && (
        <div className="element-grid">
          {[...campaign.elements]
            .sort((a, b) => a.position - b.position)
            .map((el) => (
              <ElementCard
                key={el.id}
                campaignId={campaign.id}
                element={el}
                posts={campaign.posts.filter((p) => p.element_id === el.id)}
                onOpen={() => setOpenElementId(el.id)}
              />
            ))}
          {orphanPosts.map((post) => (
            <div key={post.id} className="card element-card" onClick={() => setOpenElementId(`post:${post.id}`)}>
              <div className="element-thumb">
                <div className="image-empty">📝</div>
              </div>
              <div className="element-card-body">
                <strong className="small">{post.headline || "Post"}</strong>
                <div className="platform-chips">
                  <span className="chip">
                    <PlatformIcon platform={post.platform} size={12} /> {post.platform}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {openElement && (
        <ElementModal
          campaignId={campaign.id}
          element={openElement}
          posts={campaign.posts.filter((p) => p.element_id === openElement.id)}
          client={client}
          models={models}
          videoModels={videoModels}
          canEdit={canEdit && campaign.status !== "generating"}
          onChange={load}
          onClose={() => setOpenElementId(null)}
        />
      )}
      {openOrphan && (
        <ElementModal
          campaignId={campaign.id}
          element={null}
          posts={[openOrphan]}
          client={client}
          models={models}
          videoModels={videoModels}
          canEdit={canEdit && campaign.status !== "generating"}
          onChange={load}
          onClose={() => setOpenElementId(null)}
        />
      )}
    </div>
  );
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
      </div>
    </div>
  );
}

function ElementVideoThumb({ campaignId, video }: { campaignId: string; video: PostVideo }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    apiBlob(`/campaigns/${campaignId}/videos/${video.id}/file`)
      .then((b) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [campaignId, video.id, video.base_object_key]);
  return url ? (
    <video src={url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <div className="image-empty">🎬</div>
  );
}

function ElementThumb({ campaignId, image }: { campaignId: string; image: PostImage }) {
  const url = useImageUrl(campaignId, image);
  return url ? <img src={url} alt="element" /> : <div className="image-empty">…</div>;
}

// Resolve the preview blob URL for an image, preferring the composite when the
// canvas has visible layers (composited_object_key is cleared after each edit).
function useImageUrl(campaignId: string, image: PostImage): string {
  const [url, setUrl] = useState("");
  const state = image.canvas_state || {};
  const hasLayers =
    (state.logo?.visible !== false && !!state.logo) ||
    (state.assets || []).some((a) => a.visible !== false) ||
    (state.texts || []).some((t) => t.visible !== false);
  useEffect(() => {
    if (!image.base_object_key) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    const path =
      image.composited_object_key || hasLayers
        ? `/campaigns/${campaignId}/images/${image.id}/composite`
        : `/campaigns/${campaignId}/images/${image.id}/base`;
    apiBlob(path)
      .then((b) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, image.id, image.base_object_key, image.composited_object_key, hasLayers, image.canvas_state]);
  return url;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const activePost = posts.find((p) => p.platform === tab) ?? posts[0] ?? null;

  // Platforms sharing each image's ratio, so a visual is shown once with its audience.
  function platformsForRatio(ratio: string): string[] {
    if (!element) return [];
    return element.platforms.filter((p) => (element.platform_ratios?.[p] ?? ratio) === ratio);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal element-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{element ? element.theme || element.element_type : activePost?.headline || "Post"}</h2>
          <div className="competitor-actions">
            {element && client && posts.length > 0 && (
              <button className="btn btn-ghost" onClick={() => setPreviewOpen(true)}>
                👁 Preview
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {previewOpen && element && client && (
          <PostPreviewModal
            campaignId={campaignId}
            element={element}
            posts={posts}
            client={client}
            initialPlatform={activePost?.platform ?? element.platforms[0]}
            onClose={() => setPreviewOpen(false)}
          />
        )}

        <div className="element-modal-layout">
          {element && (
            <div className="element-visuals">
              <h3 className="small muted">Visual (shared across platforms)</h3>
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
              <div className="tab-bar">
                {posts.map((p) => (
                  <button
                    key={p.id}
                    className={`tab ${tab === p.platform ? "active" : ""}`}
                    onClick={() => setTab(p.platform)}
                  >
                    <PlatformIcon platform={p.platform} size={14} /> {p.platform}
                  </button>
                ))}
              </div>
            )}
            {activePost && (
              <CopyForm key={activePost.id} campaignId={campaignId} post={activePost} canEdit={canEdit} onChange={onChange} />
            )}
            {posts.length === 0 && <p className="muted small">This element has no posts.</p>}
          </div>
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
}: {
  campaignId: string;
  post: Post;
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const [copy, setCopy] = useState(post.copy);
  const [headline, setHeadline] = useState(post.headline);
  const [cta, setCta] = useState(post.cta);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const limit = PLATFORM_LIMITS[post.platform] ?? 2200;

  useEffect(() => {
    setCopy(post.copy);
    setHeadline(post.headline);
    setCta(post.cta);
    setHashtags(post.hashtags.join(" "));
    setDirty(false);
  }, [post.copy, post.headline, post.cta, post.hashtags]);

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
      <label className="small">
        Headline
        <input value={headline} onChange={(e) => mark(setHeadline)(e.target.value)} readOnly={!canEdit} />
      </label>
      <label className="small">
        Copy{" "}
        <span className={copy.length > limit ? "char-over" : "muted"}>
          {copy.length}/{limit}
        </span>
        <TextareaZoom label="Copy" rows={6} value={copy} onChange={(v) => mark(setCopy)(v)} readOnly={!canEdit} />
      </label>
      <label className="small">
        Call to action
        <input value={cta} onChange={(e) => mark(setCta)(e.target.value)} readOnly={!canEdit} />
      </label>
      <label className="small">
        Hashtags
        <input value={hashtags} onChange={(e) => mark(setHashtags)(e.target.value)} readOnly={!canEdit} />
      </label>
      {post.best_time && <p className="muted small">⏰ Suggested: {post.best_time}</p>}
      {post.rationale && <p className="muted small">💡 {post.rationale}</p>}
      {canEdit && (
        <div className="form-actions">
          <button className="btn btn-primary" onClick={saveCopy} disabled={!dirty || !!busy}>
            Save
          </button>
          <button className="btn btn-ghost" onClick={regenerate} disabled={!!busy}>
            Regenerate copy
          </button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
      )}
    </div>
  );
}

function ratioRank(r: string): number {
  const i = RATIO_PRIORITY.indexOf(r);
  return i === -1 ? RATIO_PRIORITY.length : i;
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
  const [showPrompt, setShowPrompt] = useState(!image.base_object_key);
  const [editorOpen, setEditorOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const url = useImageUrl(campaignId, image);

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
          <div className="image-empty">
            Generating image…
            <div className="progress-bar" style={{ width: "80%" }}>
              <div className="progress-fill indeterminate" />
            </div>
          </div>
        ) : url ? (
          <img src={url} alt="post" className="image-zoomable" onClick={() => setLightbox(true)} />
        ) : (
          <div className="image-empty">No image yet</div>
        )}
        {url && image.status !== "generating" && (
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
      {lightbox && url && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <button className="lightbox-close icon-btn" title="Close" onClick={() => setLightbox(false)}>
            <X size={20} />
          </button>
          <img src={url} alt="full size" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      <div className="image-meta small muted">
        <span className="ratio-pill">{image.aspect_ratio}</span>
        {image.status === "failed" && <span className="tag tag-red">failed</span>}
      </div>
      {(error || image.error) && <div className="alert alert-error small">{error || image.error}</div>}

      {canEdit && (
        <div className="image-actions">
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="small">
            <option value="">Default model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary small"
            onClick={generate}
            disabled={!!busy || image.status === "generating" || lockGenerate}
            title={lockGenerate && image.status !== "generating" ? "The base ratio is generating — it will create this one too" : undefined}
          >
            <Sparkles size={14} />
            {image.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : image.base_object_key ? "Regenerate" : "Generate"}
          </button>
          <button className="btn btn-ghost small" onClick={() => setShowPrompt((v) => !v)}>
            <Type size={14} /> Prompt
          </button>
          <label className={`file-btn btn btn-ghost small ${lockGenerate ? "disabled" : ""}`}>
            <UploadIcon size={14} /> Upload
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={!!busy || lockGenerate}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
          {client?.logo_object_key && (
            <button
              className="btn btn-ghost small"
              onClick={toggleLogo}
              disabled={!!busy}
              title="Include the brand logo in the generated image (applied next time you generate)"
            >
              {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
            </button>
          )}
        </div>
      )}
      {canEdit && cascades && (
        <p className="muted small cascade-note">
          <Sparkles size={12} /> Generating this base also creates the other ratios automatically.
        </p>
      )}

      {showPrompt && canEdit && (
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
            <input value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </label>
          <div className="form-actions">
            <button className="btn btn-ghost small" onClick={savePrompt}>
              Save prompt
            </button>
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
  const [showPrompt, setShowPrompt] = useState(!video.base_object_key && video.status === "draft");
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
    let objectUrl = "";
    apiBlob(`/campaigns/${campaignId}/videos/${video.id}/file`)
      .then((b) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
          <div className="image-empty">
            Generating video…
            <div className="progress-bar" style={{ width: "80%" }}>
              <div className="progress-fill indeterminate" />
            </div>
          </div>
        ) : url ? (
          <video src={url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="image-empty">🎬 No video yet</div>
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
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="small">
                <option value="">Default model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary small"
                onClick={generate}
                disabled={!!busy || video.status === "generating" || lockGenerate}
              >
                <Sparkles size={14} />
                {video.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : video.base_object_key ? "Regenerate" : "Generate"}
              </button>
              <button className="btn btn-ghost small" onClick={() => setShowPrompt((v) => !v)}>
                <Type size={14} /> Prompt
              </button>
              {client?.logo_object_key && (
                <button
                  className="btn btn-ghost small"
                  onClick={toggleLogo}
                  disabled={!!busy}
                  title="Overlay the brand logo on the video (applied next time you generate)"
                >
                  {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
                </button>
              )}
              {hasSiblings && video.base_object_key && (
                <button
                  className="btn btn-secondary small"
                  onClick={deriveVariants}
                  disabled={!!busy || lockGenerate}
                  title="Reframe this base video into the other aspect ratios"
                >
                  <Sparkles size={14} /> Generate other ratios
                </button>
              )}
            </>
          ) : (
            <span className="muted small">↳ Reframed from the base ratio</span>
          )}
          <label className={`file-btn btn btn-ghost small ${lockGenerate ? "disabled" : ""}`}>
            <UploadIcon size={14} /> Upload
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              hidden
              disabled={!!busy || lockGenerate}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {showPrompt && canEdit && isPrimary && (
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
            <button className="btn btn-ghost small" onClick={savePrompt}>
              Save prompt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
