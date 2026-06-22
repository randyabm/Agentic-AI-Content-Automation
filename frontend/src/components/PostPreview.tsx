import { useEffect, useMemo, useRef, useState } from "react";
import { getBlobUrl, hashKey } from "../lib/blobCache";
import { PlatformIcon } from "./PlatformIcon";
import { MediaSkeleton } from "./MediaSkeleton";
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

/** Live, editable post fields the preview reflects in real time. */
export type PreviewDraft = {
  headline: string;
  copy: string;
  hashtags: string; // raw, space-separated (as typed in the editor)
};

function draftFromPost(p: Post): PreviewDraft {
  return { headline: p.headline, copy: p.copy, hashtags: p.hashtags.join(" ") };
}

/** Load a protected binary as an object URL (cached at module level). */
function useBlobUrl(path: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) {
      setUrl("");
      return;
    }
    let active = true;
    getBlobUrl(path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
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
  const isComposite = img.composited_object_key || hasLayers;
  const version = isComposite
    ? hashKey(`${img.base_object_key}|${JSON.stringify(img.canvas_state || {})}`)
    : img.base_object_key;
  return `/campaigns/${campaignId}/images/${img.id}/display?v=${version}`;
}

function handleOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "brand";
}

function Avatar({ url, name, square }: { url: string; name: string; square?: boolean }) {
  const cls = `preview-avatar ${square ? "square" : ""}`;
  if (url) return <img className={cls} src={url} alt="" loading="lazy" />;
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
          // We only have a videoPath once the video is ready, so an empty url
          // here means it's still downloading — show a loading shimmer.
          <MediaSkeleton kind="video" loading label="Loading…" />
        )}
      </div>
    );
  }
  if (images.length === 0) return null;
  const generating = current?.status === "generating";
  // The image exists (was generated) but its blob hasn't downloaded yet.
  const loadingExisting = !generating && !!current?.base_object_key;
  return (
    <div className="preview-media" style={{ aspectRatio: aspect }}>
      {imgUrl ? (
        <img src={imgUrl} alt="" loading="lazy" />
      ) : (
        <MediaSkeleton
          loading={generating || loadingExisting}
          label={generating ? "Generating image…" : loadingExisting ? "Loading…" : "Image not generated yet"}
        />
      )}
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

/** A single platform's post preview, rendered from live draft fields + the
 *  element's shared visual for that platform's ratio. */
export function PostPreviewCard({
  campaignId,
  element,
  client,
  platform,
  draft,
  logoUrl,
}: {
  campaignId: string;
  element: CampaignElement;
  client: Client;
  platform: string;
  draft: PreviewDraft;
  logoUrl: string;
}) {
  const ratio = element.platform_ratios?.[platform] ?? "1:1";
  const images = useMemo(
    () => element.images.filter((i) => i.aspect_ratio === ratio),
    [element.images, ratio],
  );
  const video = element.videos.find((v) => v.aspect_ratio === ratio) ?? element.videos[0];
  const videoPath =
    element.element_type === "video" && video?.base_object_key && video.status === "ready"
      ? `/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}`
      : "";

  const name = client.company_name;
  const copyWithTags = [draft.copy, draft.hashtags].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const media = <Media campaignId={campaignId} images={images} videoPath={videoPath} ratio={ratio} />;

  if (platform === "facebook") {
    return (
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
    );
  }
  if (platform === "instagram") {
    return (
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
    );
  }
  if (platform === "linkedin") {
    return (
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
    );
  }
  if (platform === "x") {
    return (
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
    );
  }
  if (platform === "tiktok") {
    return (
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
    );
  }
  if (platform === "youtube") {
    return (
      <div className="preview-card yt">
        {media}
        <h3 style={{ margin: "0.5rem 0 0.25rem" }}>{draft.headline || name}</h3>
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
    );
  }
  return null;
}

/** Live preview column: one card per platform of the element, kept in sync with
 *  the editor drafts so changes (copy, hashtags, headline) render instantly. */
export function LivePreviewColumn({
  campaignId,
  element,
  posts,
  client,
  drafts,
  activePlatform,
}: {
  campaignId: string;
  element: CampaignElement;
  posts: Post[];
  client: Client;
  drafts: Record<string, PreviewDraft>;
  activePlatform?: string;
}) {
  // Prefer the client's profile photo as the author avatar; fall back to the logo.
  const avatarPath = client.avatar_object_key
    ? `/clients/${client.id}/avatar?v=${client.avatar_object_key}`
    : client.logo_object_key
      ? `/clients/${client.id}/logo?v=${client.logo_object_key}`
      : "";
  const logoUrl = useBlobUrl(avatarPath);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // When the editor switches platform tab, scroll the matching preview card into
  // view within the preview column so you always see what you're editing.
  useEffect(() => {
    if (!activePlatform) return;
    const el = itemRefs.current[activePlatform];
    const scroller = el?.closest(".composer-preview") as HTMLElement | null;
    if (!el || !scroller) return;
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
  }, [activePlatform]);

  // Show a card for every platform that has a post, in the element's order.
  const cards = element.platforms
    .map((platform) => ({ platform, post: posts.find((p) => p.platform === platform) ?? null }))
    .filter((c) => c.post);

  if (cards.length === 0) {
    return <p className="muted small">No posts to preview yet.</p>;
  }

  return (
    <div className="live-preview-column">
      {cards.map(({ platform, post }) => {
        const draft = (post && drafts[post.id]) || (post ? draftFromPost(post) : { headline: "", copy: "", hashtags: "" });
        const ratio = element.platform_ratios?.[platform] ?? "1:1";
        const isActive = platform === activePlatform;
        return (
          <div
            key={platform}
            ref={(node) => { itemRefs.current[platform] = node; }}
            className={`live-preview-item ${isActive ? "active" : ""}`}
          >
            <div className="live-preview-label">
              <span className="live-preview-platform">
                <PlatformIcon platform={platform} size={14} /> {PLATFORM_LABELS[platform] ?? platform}
              </span>
              <span className="ratio-pill">{ratio}</span>
            </div>
            <div className="live-preview-stage">
              <PostPreviewCard
                campaignId={campaignId}
                element={element}
                client={client}
                platform={platform}
                draft={draft}
                logoUrl={logoUrl}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
