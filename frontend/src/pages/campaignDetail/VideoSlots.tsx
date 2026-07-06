import { useEffect, useState } from "react";
import { Eye, EyeOff, Sparkles, Upload as UploadIcon } from "lucide-react";
import { api } from "../../api";
import { getBlobUrl } from "../../lib/blobCache";
import { MediaSkeleton } from "../../components/MediaSkeleton";
import { PlatformIcon } from "../../components/PlatformIcon";
import { TextareaZoom } from "../../components/TextareaZoom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useNegativePromptEnabled } from "@/lib/useSetting";
import type { Client, PostVideo, VideoModel } from "../../types";
import { ModelSelect, ratioRank, statusDot } from "./shared";

export function ElementVideoThumb({ campaignId, video }: { campaignId: string; video: PostVideo }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}`).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [campaignId, video.id, video.base_object_key]);
  return url ? <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    : <div className="p-8 text-2xl">🎬</div>;
}

export function VideoVisual({ campaignId, videos, client, models, canEdit, onChange, platformsForRatio }: { campaignId: string; videos: PostVideo[]; client: Client | null; models: VideoModel[]; canEdit: boolean; onChange: () => Promise<void>; platformsForRatio: (ratio: string) => string[] }) {
  const ordered = [...videos].sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio));
  const primaryId = ordered[0]?.id;
  const [selId, setSelId] = useState(primaryId);
  const current = ordered.find((v) => v.id === selId) ?? ordered[0];
  useEffect(() => { if (!ordered.some((v) => v.id === selId)) setSelId(primaryId); }, [ordered, selId, primaryId]);
  const slotBusy = ordered.some((v) => v.status === "generating");
  if (!current) return null;
  return (
    <div className="flex flex-col gap-2">
      {ordered.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {ordered.map((v) => (
            <button key={v.id} onClick={() => setSelId(v.id)} title={v.id === primaryId ? "Base ratio" : "Reframed from the base ratio"}
              className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", v.id === selId ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent")}>
              {v.aspect_ratio}
              {statusDot(v)}
            </button>
          ))}
        </div>
      )}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">{current.aspect_ratio}</span>
        {platformsForRatio(current.aspect_ratio).length
          ? platformsForRatio(current.aspect_ratio).map((p) => <PlatformIcon key={p} platform={p} size={14} />)
          : "all"}
      </p>
      <VideoSlot key={current.id} campaignId={campaignId} video={current} client={client} models={models}
        canEdit={canEdit} onChange={onChange} isPrimary={current.id === primaryId}
        hasSiblings={ordered.length > 1} lockGenerate={slotBusy} />
    </div>
  );
}

function VideoSlot({ campaignId, video, client, models, canEdit, onChange, isPrimary = false, hasSiblings = false, lockGenerate = false }: { campaignId: string; video: PostVideo; client?: Client | null; models: VideoModel[]; canEdit: boolean; onChange: () => Promise<void>; isPrimary?: boolean; hasSiblings?: boolean; lockGenerate?: boolean }) {
  const negativePromptEnabled = useNegativePromptEnabled();
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState(video.prompt);
  const [negative, setNegative] = useState(video.negative_prompt);
  const [modelId, setModelId] = useState(video.video_model_id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setPrompt(video.prompt); setNegative(video.negative_prompt); }, [video.prompt, video.negative_prompt]);

  useEffect(() => {
    if (!video.base_object_key || video.status !== "ready") { setUrl(""); return; }
    let active = true;
    getBlobUrl(`/campaigns/${campaignId}/videos/${video.id}/file?v=${video.base_object_key}`).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [campaignId, video.id, video.base_object_key, video.status]);

  async function savePrompt() {
    await api(`/campaigns/${campaignId}/videos/${video.id}/prompt`, { method: "PATCH", body: { prompt, negative_prompt: negative } });
    await onChange();
  }

  async function generate() {
    setBusy("Queuing…"); setError("");
    try {
      if (prompt !== video.prompt || negative !== video.negative_prompt) await savePrompt();
      await api(`/campaigns/${campaignId}/videos/${video.id}/generate`, { method: "POST", body: { video_model_id: modelId || null } });
      await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setBusy(""); }
  }

  async function upload(file: File) {
    setBusy("Uploading…");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api(`/campaigns/${campaignId}/videos/${video.id}/upload`, { method: "POST", formData: fd });
      await onChange();
    } finally { setBusy(""); }
  }

  const logoOn = (video.logo_enabled ?? true) !== false;
  async function toggleLogo() {
    setBusy("Updating…"); setError("");
    try {
      await api(`/campaigns/${campaignId}/videos/${video.id}/logo`, { method: "PATCH", body: { enabled: !logoOn } });
      await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update logo"); }
    finally { setBusy(""); }
  }

  async function deriveVariants() {
    setBusy("Queuing variants…"); setError("");
    try {
      await api(`/campaigns/${campaignId}/videos/${video.id}/derive-ratios`, { method: "POST" });
      await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate variants"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="relative" style={{ aspectRatio: video.aspect_ratio.replace(":", "/") }}>
        {video.status === "generating" ? <MediaSkeleton kind="video" loading label="Generating video…" />
        : url ? <video src={url} controls className="h-full w-full object-cover" />
        : video.base_object_key && video.status === "ready" ? <MediaSkeleton kind="video" loading label="Loading…" />
        : <MediaSkeleton kind="video" label="No video yet" />}
        {busy && <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{busy}</div>}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Video · {video.aspect_ratio} · {video.duration_seconds}s
        {video.status === "failed" && <Badge variant="destructive">failed</Badge>}
      </div>
      {(error || video.error) && <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error || video.error}</div>}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {isPrimary ? (
            <>
              <ModelSelect value={modelId} onChange={setModelId} options={models} />
              <Button size="sm" onClick={generate} disabled={!!busy || video.status === "generating" || lockGenerate}>
                <Sparkles size={14} />
                {video.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : video.base_object_key ? "Regenerate" : "Generate"}
              </Button>
              {client?.logo_object_key && (
                <Button variant="ghost" size="sm" onClick={toggleLogo} disabled={!!busy}
                  title="Overlay the brand logo on the video (applied next time you generate)">
                  {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
                </Button>
              )}
              {hasSiblings && video.base_object_key && (
                <Button variant="secondary" size="sm" onClick={deriveVariants} disabled={!!busy || lockGenerate}
                  title="Reframe this base video into the other aspect ratios">
                  <Sparkles size={14} /> Generate other ratios
                </Button>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">↳ Reframed from the base ratio</span>
          )}
          <Button asChild variant="ghost" size="sm" className={cn(lockGenerate && "pointer-events-none opacity-50")}>
            <label className="flex cursor-pointer items-center gap-1.5">
              <UploadIcon size={14} /> Upload
              <input type="file" accept="video/mp4,video/webm,video/quicktime" hidden disabled={!!busy || lockGenerate}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </Button>
        </div>
      )}

      {canEdit && isPrimary && (
        <div className="space-y-2">
          <Label className="text-sm">Video prompt
            <TextareaZoom label="Video prompt" rows={4} value={prompt} onChange={setPrompt} />
          </Label>
          {negativePromptEnabled && (
            <Label className="text-sm">Negative prompt
              <TextareaZoom label="Negative prompt" rows={2} value={negative} onChange={setNegative} />
            </Label>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={savePrompt}>Save prompt</Button>
          </div>
        </div>
      )}
    </div>
  );
}
