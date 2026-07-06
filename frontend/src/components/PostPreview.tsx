import { useEffect, useMemo, useRef, useState } from "react";
import { getBlobUrl, hashKey } from "../lib/blobCache";
import { PlatformIcon } from "./PlatformIcon";
import { MediaSkeleton } from "./MediaSkeleton";
import type { CampaignElement, Client, Post, PostImage } from "../types";
import { cn } from "@/lib/utils";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn",
  tiktok: "TikTok", x: "X (Twitter)", youtube: "YouTube",
};

const SEE_MORE_LIMIT: Record<string, number> = {
  facebook: 280, instagram: 125, linkedin: 210, tiktok: 100,
};

export type PreviewDraft = {
  headline: string;
  copy: string;
  hashtags: string;
};

function draftFromPost(p: Post): PreviewDraft {
  return { headline: p.headline, copy: p.copy, hashtags: p.hashtags.join(" ") };
}

function useBlobUrl(path: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) { setUrl(""); return; }
    let active = true;
    getBlobUrl(path).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [path]);
  return url;
}

function imagePath(campaignId: string, img: PostImage): string {
  if (!img.base_object_key) return "";
  const state = img.canvas_state || {};
  const hasLayers = (!!state.logo && state.logo.visible !== false) || (state.assets || []).some((a) => a.visible !== false) || (state.texts || []).some((t) => t.visible !== false);
  const isComposite = img.composited_object_key || hasLayers;
  const version = isComposite ? hashKey(`${img.base_object_key}|${JSON.stringify(img.canvas_state || {})}`) : img.base_object_key;
  return `/campaigns/${campaignId}/images/${img.id}/display?v=${version}`;
}

function handleOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "brand";
}

function Avatar({ url, name, square }: { url: string; name: string; square?: boolean }) {
  const cls = cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent font-bold text-white object-cover", square && "rounded-md");
  if (url) return <img className={cls} src={url} alt="" loading="lazy" />;
  return <div className={cls}>{(name[0] ?? "?").toUpperCase()}</div>;
}

function TruncatedCopy({ text, platform }: { text: string; platform: string }) {
  const [expanded, setExpanded] = useState(false);
  const limit = SEE_MORE_LIMIT[platform];
  if (!text) return <p className="preview-copy text-muted-foreground">(no copy)</p>;
  if (expanded || !limit || text.length <= limit) return <p className="preview-copy">{text}</p>;
  return (
    <p className="preview-copy">
      {text.slice(0, limit).trimEnd()}…{" "}
      <span className="cursor-pointer text-[#65676b]" onClick={() => setExpanded(true)}>
        {platform === "linkedin" ? "see more" : "See more"}
      </span>
    </p>
  );
}

function Media({ campaignId, images, videoPath, ratio }: { campaignId: string; images: PostImage[]; videoPath: string; ratio: string }) {
  const [slide, setSlide] = useState(0);
  const current = images[Math.min(slide, Math.max(0, images.length - 1))];
  const imgUrl = useBlobUrl(current ? imagePath(campaignId, current) : "");
  const vidUrl = useBlobUrl(videoPath);
  const aspect = (ratio || "1:1").replace(":", "/");

  if (videoPath) {
    return (
      <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: aspect }}>
        {vidUrl ? <video src={vidUrl} controls loop muted className="h-full w-full object-cover" />
          : <MediaSkeleton kind="video" loading label="Loading…" />}
      </div>
    );
  }
  if (images.length === 0) return null;
  const generating = current?.status === "generating";
  const loadingExisting = !generating && !!current?.base_object_key;
  return (
    <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: aspect }}>
      {generating
        ? <MediaSkeleton loading label="Generating image…" />
        : imgUrl ? <img src={imgUrl} alt="" loading="lazy" className="block h-full w-full object-cover" />
        : <MediaSkeleton loading={loadingExisting}
            label={loadingExisting ? "Loading…" : "Image not generated yet"} />}
      {images.length > 1 && (
        <>
          {slide > 0 && (
            <button onClick={() => setSlide((s) => s - 1)}
              className="absolute left-2 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/85 text-base leading-none">
              ‹
            </button>
          )}
          {slide < images.length - 1 && (
            <button onClick={() => setSlide((s) => s + 1)}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/85 text-base leading-none">
              ›
            </button>
          )}
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {images.map((_, i) => (
              <span key={i} className={cn("size-1.5 rounded-full bg-white/50", i === slide && "bg-white")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PostPreviewCard({ campaignId, element, client, platform, draft, logoUrl }: { campaignId: string; element: CampaignElement; client: Client; platform: string; draft: PreviewDraft; logoUrl: string }) {
  const ratio = element.platform_ratios?.[platform] ?? "1:1";
  const images = useMemo(() => element.images.filter((i) => i.aspect_ratio === ratio), [element.images, ratio]);
  const video = element.videos.find((v) => v.aspect_ratio === ratio) ?? element.videos[0];
  const videoPath = element.element_type === "video" && video?.base_object_key && video.status === "ready" ? `/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}` : "";

  const name = client.company_name;
  const copyWithTags = [draft.copy, draft.hashtags].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const media = <Media campaignId={campaignId} images={images} videoPath={videoPath} ratio={ratio} />;

  if (platform === "facebook") {
    return (
      <div className="w-full max-w-[470px] rounded-lg border border-[#dadde1] bg-white p-3 font-sans text-[#050505]">
        <div className="mb-1 flex items-center gap-2">
          <Avatar url={logoUrl} name={name} />
          <div>
            <strong>{name}</strong>
            <div className="text-xs text-muted-foreground">Just now · 🌐</div>
          </div>
        </div>
        <TruncatedCopy text={copyWithTags} platform="facebook" />
        {media}
        <div className="mt-2 flex gap-6 border-t border-[#eee] pt-2 text-sm text-[#65676b]">
          <span>👍 Like</span>
          <span>💬 Comment</span>
          <span>↪ Share</span>
        </div>
      </div>
    );
  }
  if (platform === "instagram") {
    return (
      <div className="w-full max-w-[470px] overflow-hidden rounded-sm bg-white font-sans text-black">
        <div className="flex items-center gap-2 px-3 py-2">
          <Avatar url={logoUrl} name={name} />
          <strong>{handleOf(name)}</strong>
          <span className="ml-auto text-muted-foreground">⋯</span>
        </div>
        {media}
        <div className="flex gap-4 px-3 py-2 text-xl">
          <span>♥</span>
          <span>💬</span>
          <span>✈</span>
          <span className="ml-auto">🔖</span>
        </div>
        <div className="px-3 text-sm">
          <strong>{handleOf(name)}</strong>{" "}
          <TruncatedCopy text={copyWithTags} platform="instagram" />
        </div>
        <div className="px-3 pb-2 text-xs text-muted-foreground">Just now</div>
      </div>
    );
  }
  if (platform === "linkedin") {
    return (
      <div className="w-full max-w-[470px] rounded-lg border border-[#dadde1] bg-white p-3 font-sans text-[#050505]">
        <div className="mb-1 flex items-center gap-2">
          <Avatar url={logoUrl} name={name} square />
          <div>
            <strong>{name}</strong>
            <div className="text-xs text-muted-foreground">{client.industry || "Company"} · Just now</div>
          </div>
          <span className="ml-auto text-muted-foreground">+ Follow</span>
        </div>
        <TruncatedCopy text={copyWithTags} platform="linkedin" />
        {media}
        <div className="mt-2 flex gap-6 border-t border-[#eee] pt-2 text-sm text-[#65676b]">
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
      <div className="w-full max-w-[470px] rounded-xl border border-[#e1e8ed] bg-white p-3 font-sans text-black">
        <div className="mb-1 flex items-center gap-2">
          <Avatar url={logoUrl} name={name} />
          <div>
            <strong>{name}</strong> <span className="text-xs text-muted-foreground">@{handleOf(name)} · now</span>
          </div>
        </div>
        <p className="preview-copy">{copyWithTags}</p>
        <div className="rounded-2xl border border-[#e1e8ed]">{media}</div>
        <div className="mt-2 flex gap-6 text-sm text-[#65676b]">
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
      <div className="relative aspect-[9/16] w-[280px] overflow-hidden rounded-3xl border-4 border-[#222] bg-black text-white">
        {media}
        <div className="absolute bottom-3.5 left-2.5 right-[60px] text-sm" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
          <strong>@{handleOf(name)}</strong>
          <TruncatedCopy text={copyWithTags} platform="tiktok" />
        </div>
        <div className="absolute bottom-[60px] right-2.5 flex flex-col gap-3.5 text-xl" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
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
      <div className="w-full max-w-[470px] bg-transparent font-sans text-black">
        {media}
        <h3 className="mt-2 mb-1 font-semibold">{draft.headline || name}</h3>
        <div className="mt-1 flex items-center gap-2">
          <Avatar url={logoUrl} name={name} />
          <div>
            <strong>{name}</strong>
            <div className="text-xs text-muted-foreground">Just now</div>
          </div>
          <span className="ml-auto rounded-[18px] bg-[#0f0f0f] px-3.5 py-1.5 text-sm text-white">Subscribe</span>
        </div>
        <TruncatedCopy text={copyWithTags} platform="facebook" />
      </div>
    );
  }
  return null;
}

export function LivePreviewColumn({ campaignId, element, posts, client, drafts, activePlatform }: { campaignId: string; element: CampaignElement; posts: Post[]; client: Client; drafts: Record<string, PreviewDraft>; activePlatform?: string }) {
  const avatarPath = client.avatar_object_key ? `/clients/${client.id}/avatar?v=${client.avatar_object_key}`
    : client.logo_object_key ? `/clients/${client.id}/logo?v=${client.logo_object_key}` : "";
  const logoUrl = useBlobUrl(avatarPath);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!activePlatform) return;
    const el = itemRefs.current[activePlatform];
    const scroller = el?.closest(".composer-preview") as HTMLElement | null;
    if (!el || !scroller) return;
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
  }, [activePlatform]);

  const cards = element.platforms
    .map((platform) => ({ platform, post: posts.find((p) => p.platform === platform) ?? null }))
    .filter((c) => c.post);

  if (cards.length === 0) return <p className="text-sm text-muted-foreground">No posts to preview yet.</p>;

  return (
    <div className="flex flex-col gap-5">
      {cards.map(({ platform, post }) => {
        const draft = (post && drafts[post.id]) || (post ? draftFromPost(post) : { headline: "", copy: "", hashtags: "" });
        const ratio = element.platform_ratios?.[platform] ?? "1:1";
        const isActive = platform === activePlatform;
        return (
          <div key={platform} ref={(node) => { itemRefs.current[platform] = node; }}
            className={cn("rounded-xl p-1 transition-shadow", isActive && "shadow-[0_0_0_2px_var(--primary-soft-border)]")}>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                <PlatformIcon platform={platform} size={14} /> {PLATFORM_LABELS[platform] ?? platform}
              </span>
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">{ratio}</span>
            </div>
            <div className="flex justify-center [&_.preview-card]:max-w-full">
              <PostPreviewCard campaignId={campaignId} element={element} client={client} platform={platform} draft={draft} logoUrl={logoUrl} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
