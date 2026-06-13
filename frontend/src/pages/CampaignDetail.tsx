import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiBlob, downloadFile } from "../api";
import { ImageEditor } from "../components/ImageEditor";
import { PostPreviewModal } from "../components/PostPreview";
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
                <span className="chip">{post.platform}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

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
        {cover ? (
          <ElementThumb campaignId={campaignId} image={cover} />
        ) : coverVideo ? (
          <ElementVideoThumb campaignId={campaignId} video={coverVideo} />
        ) : (
          <div className="image-empty">{videoCount > 0 && element.images.length === 0 ? "🎬 No video yet" : "No image yet"}</div>
        )}
      </div>
      <div className="element-card-body">
        <strong className="small element-headline">{headline}</strong>
        <div className="platform-chips">
          {element.platforms.map((p) => (
            <span key={p} className="chip">
              {p}
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
              <h3 className="small muted">Visuals (shared across platforms)</h3>
              {element.images.map((img) => (
                <div key={img.id}>
                  <p className="muted small">
                    🔗 {img.aspect_ratio} → {platformsForRatio(img.aspect_ratio).join(", ") || "all"}
                  </p>
                  <ImageSlot
                    campaignId={campaignId}
                    image={img}
                    client={client}
                    models={models}
                    canEdit={canEdit}
                    onChange={onChange}
                  />
                </div>
              ))}
              {element.videos.map((video) => (
                <VideoSlot
                  key={video.id}
                  campaignId={campaignId}
                  video={video}
                  models={videoModels}
                  canEdit={canEdit}
                  onChange={onChange}
                />
              ))}
              {canEdit && (
                <AddVideoButton
                  campaignId={campaignId}
                  elementId={element.id}
                  ratio={element.platform_ratios?.[posts[0]?.platform ?? ""] ?? element.images[0]?.aspect_ratio}
                  platform={posts[0]?.platform ?? "facebook"}
                  onChange={onChange}
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
                    {p.platform}
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
        <textarea rows={6} value={copy} onChange={(e) => mark(setCopy)(e.target.value)} readOnly={!canEdit} />
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

function ImageSlot({
  campaignId,
  image,
  client,
  models,
  canEdit,
  onChange,
}: {
  campaignId: string;
  image: PostImage;
  client: Client | null;
  models: ImageModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(image.prompt);
  const [negative, setNegative] = useState(image.negative_prompt);
  const [guidance, setGuidance] = useState(image.additional_guidance);
  const [modelId, setModelId] = useState(image.image_model_id ?? "");
  // Surface the prompt before the first generation so it can be tuned upfront.
  const [showPrompt, setShowPrompt] = useState(!image.base_object_key);
  const [editorOpen, setEditorOpen] = useState(false);
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
          <img src={url} alt="post" />
        ) : (
          <div className="image-empty">No image yet</div>
        )}
        {busy && <div className="image-busy">{busy}</div>}
      </div>
      <div className="image-meta small muted">
        {image.aspect_ratio}
        {image.status === "failed" && <span className="tag tag-red"> failed</span>}
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
          <button className="btn btn-primary small" onClick={generate} disabled={!!busy || image.status === "generating"}>
            {image.status === "generating" ? "Generating…" : image.base_object_key ? "Regenerate" : "Generate"}
          </button>
          <button className="btn btn-ghost small" onClick={() => setShowPrompt((v) => !v)}>
            Prompt
          </button>
          {image.base_object_key && (
            <button className="btn btn-ghost small" onClick={() => setEditorOpen(true)}>
              Edit image
            </button>
          )}
          <label className="file-btn btn btn-ghost small">
            Upload
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      )}

      {showPrompt && canEdit && (
        <div className="prompt-editor">
          <label className="small">
            Image prompt
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="small">
            Negative prompt
            <textarea rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} />
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

function AddVideoButton({
  campaignId,
  elementId,
  ratio,
  platform,
  onChange,
}: {
  campaignId: string;
  elementId: string;
  ratio: string | undefined;
  platform: string;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const vertical = platform === "instagram" || platform === "tiktok";

  async function add() {
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/elements/${elementId}/videos`, {
        method: "POST",
        body: { aspect_ratio: ratio || (vertical ? "9:16" : "16:9"), duration_seconds: 8 },
      });
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn btn-ghost small" onClick={add} disabled={busy}>
      {busy ? "Adding…" : "+ Add video"}
    </button>
  );
}

function VideoSlot({
  campaignId,
  video,
  models,
  canEdit,
  onChange,
}: {
  campaignId: string;
  video: PostVideo;
  models: VideoModel[];
  canEdit: boolean;
  onChange: () => Promise<void>;
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

  async function remove() {
    if (!window.confirm("Remove this video slot?")) return;
    await api(`/campaigns/${campaignId}/videos/${video.id}`, { method: "DELETE" });
    await onChange();
  }

  return (
    <div className="image-slot video-slot">
      <div className="image-thumb" style={{ aspectRatio: video.aspect_ratio.replace(":", "/") }}>
        {url ? (
          <video src={url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : video.status === "generating" ? (
          <div className="image-empty">
            Generating video…
            <div className="progress-bar" style={{ width: "80%" }}>
              <div className="progress-fill indeterminate" />
            </div>
          </div>
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
            disabled={!!busy || video.status === "generating"}
          >
            {video.status === "generating" ? "Generating…" : video.base_object_key ? "Regenerate" : "Generate"}
          </button>
          <button className="btn btn-ghost small" onClick={() => setShowPrompt((v) => !v)}>
            Prompt
          </button>
          <label className="file-btn btn btn-ghost small">
            Upload
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
          <button className="btn btn-ghost small danger" onClick={remove}>
            ✕
          </button>
        </div>
      )}

      {showPrompt && canEdit && (
        <div className="prompt-editor">
          <label className="small">
            Video prompt
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="small">
            Negative prompt
            <textarea rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} />
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
