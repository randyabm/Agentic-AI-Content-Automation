import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiBlob, downloadFile } from "../api";
import { ImageEditor } from "../components/ImageEditor";
import { useAuth } from "../auth";
import type {
  CampaignDetail as Campaign,
  Client,
  ImageModel,
  Post,
  PostImage,
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const canEdit = user?.role === "admin" || user?.role === "editor";

  async function load() {
    const c = await api<Campaign>(`/campaigns/${campaignId}`);
    setCampaign(c);
    if (!client) api<Client>(`/clients/${c.client_id}`).then(setClient).catch(() => {});
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<ImageModel[]>("/image-models").then(setModels).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (campaign?.status !== "generating") return;
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.status]);

  if (!campaign) return <div className="page-loading">Loading…</div>;

  const platforms = Array.from(new Set(campaign.posts.map((p) => p.platform)));

  async function regenerateAll() {
    setBusy("Regenerating…");
    try {
      await api(`/campaigns/${campaign!.id}/regenerate`, { method: "POST", body: {} });
      await load();
    } finally {
      setBusy("");
    }
  }

  async function regeneratePlatform(platform: string) {
    setBusy(`Regenerating ${platform}…`);
    try {
      await api(`/campaigns/${campaign!.id}/platforms/${platform}/regenerate`, { method: "POST", body: {} });
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

      {platforms.map((platform) => (
        <div key={platform} className="platform-section">
          <div className="card-header">
            <h2>{platform}</h2>
            {canEdit && campaign.status !== "generating" && (
              <button className="btn btn-ghost" onClick={() => regeneratePlatform(platform)} disabled={!!busy}>
                Regenerate {platform}
              </button>
            )}
          </div>
          {campaign.posts
            .filter((p) => p.platform === platform)
            .map((post) => (
              <PostCard
                key={post.id}
                campaignId={campaign.id}
                post={post}
                client={client}
                models={models}
                canEdit={canEdit}
                onChange={load}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function PostCard({
  campaignId,
  post,
  client,
  models,
  canEdit,
  onChange,
}: {
  campaignId: string;
  post: Post;
  client: Client | null;
  models: ImageModel[];
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
    <div className="card post-card">
      <div className="post-main">
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

        <div className="post-images">
          {post.images.map((img) => (
            <ImageSlot
              key={img.id}
              campaignId={campaignId}
              image={img}
              client={client}
              models={models}
              canEdit={canEdit}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
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
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState(image.prompt);
  const [negative, setNegative] = useState(image.negative_prompt);
  const [guidance, setGuidance] = useState(image.additional_guidance);
  const [modelId, setModelId] = useState(image.image_model_id ?? "");
  const [showPrompt, setShowPrompt] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Refetch the preview whenever the base or composite changes.
  useEffect(() => {
    if (!image.base_object_key) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    const path = image.composited_object_key
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
  }, [campaignId, image.id, image.base_object_key, image.composited_object_key]);

  async function savePrompt() {
    await api(`/campaigns/${campaignId}/images/${image.id}/prompt`, {
      method: "PATCH",
      body: { prompt, negative_prompt: negative, additional_guidance: guidance },
    });
    await onChange();
  }

  async function generate() {
    setBusy("Generating image…");
    setError("");
    try {
      if (prompt !== image.prompt || negative !== image.negative_prompt || guidance !== image.additional_guidance) {
        await savePrompt();
      }
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
        {url ? <img src={url} alt="post" /> : <div className="image-empty">No image yet</div>}
        {busy && <div className="image-busy">{busy}</div>}
      </div>
      <div className="image-meta small muted">{image.aspect_ratio}</div>
      {error && <div className="alert alert-error small">{error}</div>}

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
          <button className="btn btn-primary small" onClick={generate} disabled={!!busy}>
            {image.base_object_key ? "Regenerate" : "Generate"}
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
