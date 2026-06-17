import { useEffect, useMemo, useState } from "react";
import { apiBlob } from "../api";
import { PlatformIcon } from "./PlatformIcon";
import type { CampaignElement, Client, Post, PostImage } from "../types";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x: "X (Twitter)",
  youtube: "YouTube",
};

// Where each platform clamps the visible copy before "see more".
const SEE_MORE_LIMIT: Record<string, number> = {
  facebook: 280,
  instagram: 125,
  linkedin: 210,
  tiktok: 100,
};

/** Load a protected binary as an object URL (revoked on cleanup). */
function useBlobUrl(path: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
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
  }, [path]);
  return url;
}

function imagePath(campaignId: string, img: PostImage): string {
  if (!img.base_object_key) return "";
  const state = img.canvas_state || {};
  const hasLayers =
    (!!state.logo && state.logo.visible !== false) ||
    (state.assets || []).some((a) => a.visible !== false) ||
    (state.texts || []).some((t) => t.visible !== false);
  return img.composited_object_key || hasLayers
    ? `/campaigns/${campaignId}/images/${img.id}/composite`
    : `/campaigns/${campaignId}/images/${img.id}/base`;
}

function handleOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "brand";
}

function Avatar({ url, name, square }: { url: string; name: string; square?: boolean }) {
  const cls = `preview-avatar ${square ? "square" : ""}`;
  if (url) return <img className={cls} src={url} alt="" />;
  return <div className={cls}>{(name[0] ?? "?").toUpperCase()}</div>;
}

function TruncatedCopy({ text, platform }: { text: string; platform: string }) {
  const [expanded, setExpanded] = useState(false);
  const limit = SEE_MORE_LIMIT[platform];
  if (!text) return <p className="preview-copy muted">(no copy)</p>;
  if (expanded || !limit || text.length <= limit) return <p className="preview-copy">{text}</p>;
  return (
    <p className="preview-copy">
      {text.slice(0, limit).trimEnd()}…{" "}
      <span className="preview-see-more" onClick={() => setExpanded(true)}>
        {platform === "linkedin" ? "see more" : "See more"}
      </span>
    </p>
  );
}

/** The media block of a preview: carousel-aware image(s) or video, at the platform's ratio. */
function Media({
  campaignId,
  images,
  videoPath,
  ratio,
}: {
  campaignId: string;
  images: PostImage[];
  videoPath: string;
  ratio: string;
}) {
  const [slide, setSlide] = useState(0);
  const current = images[Math.min(slide, Math.max(0, images.length - 1))];
  const imgUrl = useBlobUrl(current ? imagePath(campaignId, current) : "");
  const vidUrl = useBlobUrl(videoPath);
  const aspect = (ratio || "1:1").replace(":", "/");

  if (videoPath) {
    return (
      <div className="preview-media" style={{ aspectRatio: aspect }}>
        {vidUrl ? (
          <video src={vidUrl} controls loop muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="image-empty">🎬 Video not generated yet</div>
        )}
      </div>
    );
  }
  if (images.length === 0) return null;
  return (
    <div className="preview-media" style={{ aspectRatio: aspect }}>
      {imgUrl ? <img src={imgUrl} alt="" /> : <div className="image-empty">No image generated yet</div>}
      {images.length > 1 && (
        <>
          {slide > 0 && (
            <button className="preview-arrow left" onClick={() => setSlide((s) => s - 1)}>
              ‹
            </button>
          )}
          {slide < images.length - 1 && (
            <button className="preview-arrow right" onClick={() => setSlide((s) => s + 1)}>
              ›
            </button>
          )}
          <div className="preview-dots">
            {images.map((_, i) => (
              <span key={i} className={`preview-dot ${i === slide ? "active" : ""}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PostPreviewModal({
  campaignId,
  element,
  posts,
  client,
  initialPlatform,
  onClose,
}: {
  campaignId: string;
  element: CampaignElement;
  posts: Post[];
  client: Client;
  initialPlatform: string;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState(initialPlatform);
  // Prefer the client's profile photo as the author avatar; fall back to the logo.
  const avatarPath = client.avatar_object_key
    ? `/clients/${client.id}/avatar`
    : client.logo_object_key
      ? `/clients/${client.id}/logo`
      : "";
  const logoUrl = useBlobUrl(avatarPath);

  const post = posts.find((p) => p.platform === platform) ?? null;
  const ratio = element.platform_ratios?.[platform] ?? "1:1";
  const images = useMemo(
    () => element.images.filter((i) => i.aspect_ratio === ratio),
    [element.images, ratio],
  );
  const video = element.videos.find((v) => v.aspect_ratio === ratio) ?? element.videos[0];
  const videoPath =
    element.element_type === "video" && video?.base_object_key && video.status === "ready"
      ? `/campaigns/${campaignId}/videos/${video.id}/file`
      : "";

  const name = client.company_name;
  const copyWithTags = post ? [post.copy, post.hashtags.join(" ")].filter(Boolean).join("\n\n") : "";
  const media = (
    <Media campaignId={campaignId} images={images} videoPath={videoPath} ratio={ratio} />
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Post preview</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="source-tabs">
          {element.platforms.map((p) => (
            <button
              key={p}
              type="button"
              className={`tab ${platform === p ? "tab-active" : ""}`}
              onClick={() => setPlatform(p)}
            >
              <PlatformIcon platform={p} size={15} /> {PLATFORM_LABELS[p] ?? p}
            </button>
          ))}
        </div>
        <p className="muted small">Simulated preview — approximation of how the post will look when published.</p>

        <div className="preview-stage">
          {!post && <p className="muted">No post was generated for this platform.</p>}

          {post && platform === "facebook" && (
            <div className="preview-card fb">
              <div className="preview-head">
                <Avatar url={logoUrl} name={name} />
                <div>
                  <strong>{name}</strong>
                  <div className="muted small">Just now · 🌐</div>
                </div>
              </div>
              <TruncatedCopy text={copyWithTags} platform="facebook" />
              {media}
              <div className="preview-actions-row">
                <span>👍 Like</span>
                <span>💬 Comment</span>
                <span>↪ Share</span>
              </div>
            </div>
          )}

          {post && platform === "instagram" && (
            <div className="preview-card ig">
              <div className="preview-head">
                <Avatar url={logoUrl} name={name} />
                <strong>{handleOf(name)}</strong>
                <span className="muted" style={{ marginLeft: "auto" }}>
                  ⋯
                </span>
              </div>
              {media}
              <div className="preview-actions-row ig-icons">
                <span>♥</span>
                <span>💬</span>
                <span>✈</span>
                <span style={{ marginLeft: "auto" }}>🔖</span>
              </div>
              <div className="preview-copy">
                <strong>{handleOf(name)}</strong>{" "}
                <TruncatedCopy text={copyWithTags} platform="instagram" />
              </div>
              <div className="muted small">Just now</div>
            </div>
          )}

          {post && platform === "linkedin" && (
            <div className="preview-card li">
              <div className="preview-head">
                <Avatar url={logoUrl} name={name} square />
                <div>
                  <strong>{name}</strong>
                  <div className="muted small">{client.industry || "Company"} · Just now</div>
                </div>
                <span className="muted" style={{ marginLeft: "auto" }}>
                  + Follow
                </span>
              </div>
              <TruncatedCopy text={copyWithTags} platform="linkedin" />
              {media}
              <div className="preview-actions-row">
                <span>👍 Like</span>
                <span>💬 Comment</span>
                <span>🔁 Repost</span>
                <span>📤 Send</span>
              </div>
            </div>
          )}

          {post && platform === "x" && (
            <div className="preview-card x-card">
              <div className="preview-head">
                <Avatar url={logoUrl} name={name} />
                <div>
                  <strong>{name}</strong> <span className="muted small">@{handleOf(name)} · now</span>
                </div>
              </div>
              <p className="preview-copy">{copyWithTags}</p>
              <div className="preview-media-rounded">{media}</div>
              <div className="preview-actions-row">
                <span>💬</span>
                <span>🔁</span>
                <span>♥</span>
                <span>📊</span>
                <span>📤</span>
              </div>
            </div>
          )}

          {post && platform === "tiktok" && (
            <div className="preview-phone">
              {media}
              <div className="preview-phone-overlay">
                <strong>@{handleOf(name)}</strong>
                <TruncatedCopy text={copyWithTags} platform="tiktok" />
              </div>
              <div className="preview-phone-rail">
                <span>♥</span>
                <span>💬</span>
                <span>🔖</span>
                <span>↪</span>
              </div>
            </div>
          )}

          {post && platform === "youtube" && (
            <div className="preview-card yt">
              {media}
              <h3 style={{ margin: "0.5rem 0 0.25rem" }}>{post.headline || name}</h3>
              <div className="preview-head" style={{ marginTop: "0.25rem" }}>
                <Avatar url={logoUrl} name={name} />
                <div>
                  <strong>{name}</strong>
                  <div className="muted small">Just now</div>
                </div>
                <span className="preview-subscribe">Subscribe</span>
              </div>
              <TruncatedCopy text={copyWithTags} platform="facebook" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
