import { useEffect, useState } from "react";
import { Download, Eye, EyeOff, Maximize2, Pencil, Sparkles, Upload as UploadIcon, Wand2, X } from "lucide-react";
import { api, downloadFile } from "../../api";
import { getBlobUrl, hashKey } from "../../lib/blobCache";
import { ImageEditor } from "../../components/ImageEditor";
import { MediaSkeleton } from "../../components/MediaSkeleton";
import { PlatformIcon } from "../../components/PlatformIcon";
import { TextareaZoom } from "../../components/TextareaZoom";
import { StyleAlternativesDialog } from "../../components/StyleAlternativesDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isRemix, styleFamilyLabel, styleFamilyTint } from "@/lib/styleFamilies";
import type { Client, ImageModel, PostImage } from "../../types";
import { ModelSelect, ratioRank, statusDot } from "./shared";

export function PostThumbnail({ campaignId, image }: { campaignId: string; image: PostImage }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!image.base_object_key) return;
    let active = true;
    // Bust the cache on regeneration: the display variant lives at a fixed key
    // and is served `immutable, max-age=86400`, so without ?v= the browser keeps
    // showing the old image for 24h. base_object_key changes (v1→v2) every regen.
    getBlobUrl(`/campaigns/${campaignId}/images/${image.id}/display?v=${encodeURIComponent(image.base_object_key)}`).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [campaignId, image.id, image.base_object_key]);
  return url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null;
}

export function ElementThumb({ campaignId, image }: { campaignId: string; image: PostImage }) {
  const { preview } = useImageUrl(campaignId, image);
  return preview ? <img src={preview} alt="element" loading="lazy" /> : <div className="p-8 text-muted-foreground">…</div>;
}

function useImageUrl(campaignId: string, image: PostImage): { preview: string; full: string } {
  const [preview, setPreview] = useState("");
  const [full, setFull] = useState("");
  const state = image.canvas_state || {};
  const hasLayers = (state.logo?.visible !== false && !!state.logo) || (state.assets || []).some((a) => a.visible !== false) || (state.texts || []).some((t) => t.visible !== false);
  useEffect(() => {
    if (!image.base_object_key) { setPreview(""); setFull(""); return; }
    let active = true;
    const isComposite = image.composited_object_key || hasLayers;
    const version = isComposite ? hashKey(`${image.base_object_key}|${JSON.stringify(image.canvas_state || {})}`) : image.base_object_key;
    const previewPath = `/campaigns/${campaignId}/images/${image.id}/display?v=${version}`;
    const fullPath = `/campaigns/${campaignId}/images/${image.id}/display?v=${version}&w=1600`;
    getBlobUrl(previewPath).then((u) => { if (active) setPreview(u); });
    getBlobUrl(fullPath).then((u) => { if (active) setFull(u); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, image.id, image.base_object_key, image.composited_object_key, hasLayers, image.canvas_state]);
  return { preview, full };
}

export function ElementVisual({ campaignId, images, client, models, canEdit, onChange, platformsForRatio }: { campaignId: string; images: PostImage[]; client: Client | null; models: ImageModel[]; canEdit: boolean; onChange: () => Promise<void>; platformsForRatio: (ratio: string) => string[] }) {
  const slots = Array.from(new Set(images.map((i) => i.slot_index))).sort((a, b) => a - b);
  const isCarousel = slots.length > 1;
  const [slot, setSlot] = useState(slots[0] ?? 0);

  const slotImages = images.filter((i) => i.slot_index === (slots.includes(slot) ? slot : slots[0]))
    .sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio));
  const primaryId = slotImages[0]?.id;
  const [selId, setSelId] = useState(primaryId);
  const current = slotImages.find((i) => i.id === selId) ?? slotImages[0];
  const slotBusy = slotImages.some((i) => i.status === "generating");

  useEffect(() => { if (!slotImages.some((i) => i.id === selId)) setSelId(primaryId); }, [slotImages, selId, primaryId]);

  if (!current) return null;
  return (
    <div className="flex flex-col gap-3">
      {isCarousel && (
        <div className="flex flex-wrap gap-1">
          {slots.map((s, idx) => {
            const slotPrimary = images.filter((i) => i.slot_index === s)
              .sort((a, b) => ratioRank(a.aspect_ratio) - ratioRank(b.aspect_ratio))[0];
            return (
              <button key={s} onClick={() => setSlot(s)}
                className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", s === slot ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent")}>
                Slide {idx + 1}
                {statusDot(slotPrimary)}
              </button>
            );
          })}
        </div>
      )}
      {slotImages.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {slotImages.map((img) => (
            <button key={img.id} onClick={() => setSelId(img.id)} title={img.id === primaryId ? "Base ratio" : "Derived from the base ratio"}
              className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", img.id === selId ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent")}>
              {img.aspect_ratio}
              {statusDot(img)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">{current.aspect_ratio}</span>
        <span className="text-muted-foreground/60">·</span>
        {platformsForRatio(current.aspect_ratio).length
          ? platformsForRatio(current.aspect_ratio).map((p) => <PlatformIcon key={p} platform={p} size={14} />)
          : <span>all platforms</span>}
      </div>
      <ImageSlot key={current.id} campaignId={campaignId} image={current} client={client} models={models}
        canEdit={canEdit} onChange={onChange} cascades={current.id === primaryId && slotImages.length > 1} lockGenerate={slotBusy} />
    </div>
  );
}

function ImageSlot({ campaignId, image, client, models, canEdit, onChange, cascades = false, lockGenerate = false }: { campaignId: string; image: PostImage; client: Client | null; models: ImageModel[]; canEdit: boolean; onChange: () => Promise<void>; cascades?: boolean; lockGenerate?: boolean }) {
  const [prompt, setPrompt] = useState(image.prompt);
  const [negative, setNegative] = useState(image.negative_prompt);
  const [guidance, setGuidance] = useState(image.additional_guidance);
  const [modelId, setModelId] = useState(image.image_model_id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [styleAltOpen, setStyleAltOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { preview, full } = useImageUrl(campaignId, image);

  useEffect(() => {
    setPrompt(image.prompt);
    setNegative(image.negative_prompt);
    setGuidance(image.additional_guidance);
  }, [image.prompt, image.negative_prompt, image.additional_guidance]);

  async function savePrompt() {
    await api(`/campaigns/${campaignId}/images/${image.id}/prompt`, { method: "PATCH", body: { prompt, negative_prompt: negative, additional_guidance: guidance } });
    await onChange();
  }

  async function generate() {
    setBusy("Queuing…");
    setError("");
    try {
      if (prompt !== image.prompt || negative !== image.negative_prompt || guidance !== image.additional_guidance) await savePrompt();
      await api(`/campaigns/${campaignId}/images/${image.id}/generate`, { method: "POST", body: { image_model_id: modelId || null } });
      await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setBusy(""); }
  }

  async function upload(file: File) {
    setBusy("Uploading…");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api(`/campaigns/${campaignId}/images/${image.id}/upload`, { method: "POST", formData: fd });
      await onChange();
    } finally { setBusy(""); }
  }

  async function download() {
    setBusy("Preparing…"); setError("");
    try {
      const name = `image-${image.aspect_ratio.replace(":", "x")}.png`;
      await downloadFile(`/campaigns/${campaignId}/images/${image.id}/composite`, name);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(""); }
  }

  const logoOn = (image.canvas_state?.logo_enabled ?? true) !== false;
  async function toggleLogo() {
    setBusy("Updating…"); setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/logo`, { method: "PATCH", body: { enabled: !logoOn } });
      await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update logo"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="relative" style={{ aspectRatio: image.aspect_ratio.replace(":", "/") }}>
        {image.status === "generating" ? <MediaSkeleton loading label="Generating image…" />
        : preview ? <img src={preview} alt="post" className="h-full w-full cursor-zoom-in object-contain" onClick={() => setLightbox(true)} />
        : image.base_object_key ? <MediaSkeleton loading label="Loading…" />
        : <MediaSkeleton label="No image yet" />}
        {preview && image.status !== "generating" && (
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity hover:opacity-100">
            <button title="View full size" onClick={() => setLightbox(true)} className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm hover:bg-black/80">
              <Maximize2 size={18} />
            </button>
            {canEdit && image.base_object_key && (
              <button title="Edit image" onClick={() => setEditorOpen(true)} className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm hover:bg-black/80">
                <Pencil size={18} />
              </button>
            )}
            <button title="Download image" onClick={download} disabled={!!busy} className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-50">
              <Download size={18} />
            </button>
          </div>
        )}
        {busy && <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{busy}</div>}
      </div>
      {lightbox && preview && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setLightbox(false)}>
          <button title="Close" onClick={() => setLightbox(false)} className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-md bg-white/20 text-white hover:bg-white/30">
            <X size={20} />
          </button>
          <img src={full || preview} alt="full size" className="max-h-[90vh] max-w-[90vw] rounded-2xl bg-white object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {image.status === "failed" && <Badge variant="destructive">failed</Badge>}
        {image.style_family && (
          <span
            title={image.style_family}
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-gradient-to-r px-2 py-0.5 text-[0.65rem] font-medium text-white",
              styleFamilyTint(image.style_family),
            )}
          >
            {isRemix(image.style_family) && <span className="opacity-75">Remix ·</span>}
            {styleFamilyLabel(image.style_family)}
          </span>
        )}
      </div>
      {(error || image.error) && (
        <div className="rounded-lg border-l-[3px] border-red-500 bg-red-50 p-2.5 text-sm text-red-700">
          {error || image.error}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <ModelSelect value={modelId} onChange={setModelId} options={models} />
          <Button size="sm" onClick={generate} disabled={!!busy || image.status === "generating" || lockGenerate}
            title={lockGenerate && image.status !== "generating" ? "The base ratio is generating — it will create this one too" : undefined}>
            <Sparkles size={14} />
            {image.status === "generating" ? "Generating…" : lockGenerate ? "In queue…" : image.base_object_key ? "Regenerate" : "Generate"}
          </Button>
          {image.base_object_key && (
            <Button variant="outline" size="sm" onClick={() => setStyleAltOpen(true)} disabled={!!busy || image.status === "generating" || lockGenerate}
              title="Ask the Visual Agent for 3 different style directions">
              <Wand2 size={14} /> Try a different style
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className={cn(lockGenerate && "pointer-events-none opacity-50")}>
            <label className="flex cursor-pointer items-center gap-1.5">
              <UploadIcon size={14} /> Upload
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!busy || lockGenerate}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </Button>
          {client?.logo_object_key && (
            <Button variant="ghost" size="sm" onClick={toggleLogo} disabled={!!busy}
              title="Include the brand logo in the generated image (applied next time you generate)">
              {logoOn ? <Eye size={14} /> : <EyeOff size={14} />} Logo {logoOn ? "on" : "off"}
            </Button>
          )}
        </div>
      )}

      <StyleAlternativesDialog
        open={styleAltOpen}
        onOpenChange={setStyleAltOpen}
        campaignId={campaignId}
        imageId={image.id}
        onApplied={onChange}
      />
      {canEdit && cascades && (
        <p className="m-0 flex items-center gap-1.5 rounded-md border border-dashed border-border bg-accent/40 px-2.5 py-1.5 text-xs text-muted-foreground">
          <Sparkles size={12} className="text-primary" />
          Generating this base also creates the other ratios automatically.
        </p>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-alt/40 p-3">
          <header className="flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles size={12} className="text-primary" /> Prompt engineering
            </h4>
            {image.prompt_history.length > 0 && (
              <span className="text-[0.65rem] text-muted-foreground">
                {image.prompt_history.length} previous version{image.prompt_history.length === 1 ? "" : "s"}
              </span>
            )}
          </header>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Image prompt</Label>
            <TextareaZoom label="Image prompt" rows={3} value={prompt} onChange={setPrompt} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Negative prompt</Label>
            <TextareaZoom label="Negative prompt" rows={2} value={negative} onChange={setNegative} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Additional guidance</Label>
            <Input value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. brand-safe, family-friendly" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={savePrompt}>
              Save prompt
            </Button>
          </div>
        </div>
      )}

      {editorOpen && client && (
        <ImageEditor campaignId={campaignId} image={image} client={client} onClose={() => setEditorOpen(false)} onSaved={onChange} />
      )}
    </div>
  );
}
