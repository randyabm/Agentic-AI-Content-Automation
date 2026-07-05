import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api, apiBlob, downloadFile } from "../api";
import { TextareaZoom } from "./TextareaZoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CanvasState, Client, LayerGeom, PostAsset, PostImage, TextLayerState } from "../types";

const STAGE_W = 460;

function ratioToHeight(aspect: string, width: number): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return width;
  return Math.round((width * h) / w);
}

interface EditorLayer extends LayerGeom {
  key: string;
  kind: "logo" | "asset";
  url: string;
  label: string;
}

const TEXT_FONTS: Record<TextLayerState["font"], string> = {
  sans: "'DejaVu Sans', Verdana, Arial, sans-serif",
  serif: "'DejaVu Serif', Georgia, serif",
  mono: "'DejaVu Sans Mono', 'Courier New', monospace",
};

// Resize-handle positioning — placed on a single base class with corner variants.
const HANDLE_BASE = "absolute size-3.5 rounded-full border-2 border-primary bg-white shadow-md z-[2] touch-none";
const HANDLE_CORNERS = {
  tl: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  tr: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  bl: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  br: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  rotate: "top-0 left-1/2 -translate-x-1/2 -translate-y-[32px] cursor-grab bg-primary border-white",
} as const;

export function ImageEditor({ campaignId, image, client, onClose, onSaved }: { campaignId: string; image: PostImage; client: Client; onClose: () => void; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [baseAspect, setBaseAspect] = useState(0);
  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const [texts, setTexts] = useState<TextLayerState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<PostAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const drag = useRef<
    | {
        key: string;
        mode: "move" | "resize" | "rotate";
        isText: boolean;
        dx?: number; dy?: number;
        cxFrac?: number; cyFrac?: number;
        startDist?: number; startScale?: number; startW?: number; startH?: number;
        startAngle?: number; startRot?: number;
      } | null
  >(null);

  const stageH = baseAspect > 0 ? Math.round(STAGE_W * baseAspect) : ratioToHeight(image.aspect_ratio, STAGE_W);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    (async () => {
      try {
        const baseBlob = await apiBlob(`/campaigns/${campaignId}/images/${image.id}/base`);
        const bu = URL.createObjectURL(baseBlob);
        urls.push(bu);
        if (active) setBaseUrl(bu);

        const assetList = await api<PostAsset[]>(`/campaigns/${campaignId}/assets`);
        if (active) setAssets(assetList);

        const state: CanvasState = image.canvas_state || {};
        const built: EditorLayer[] = [];

        if (client.logo_object_key) {
          const logoBlob = await apiBlob(`/clients/${client.id}/logo`);
          const lu = URL.createObjectURL(logoBlob);
          urls.push(lu);
          const g = state.logo;
          built.push({
            key: "logo", kind: "logo", url: lu, label: "Logo",
            x: g?.x ?? 0.05, y: g?.y ?? 0.05, scale: g?.scale ?? 0.25,
            opacity: g?.opacity ?? 1, rotation: g?.rotation ?? 0,
            locked: g?.locked ?? false, visible: g?.visible ?? true, z: 999,
          });
        }

        for (const a of assetList) {
          const ab = await apiBlob(`/campaigns/${campaignId}/assets/${a.id}/file`);
          const au = URL.createObjectURL(ab);
          urls.push(au);
          const g = (state.assets || []).find((s) => s.asset_id === a.id);
          built.push({
            key: `asset:${a.id}`, kind: "asset", asset_id: a.id, url: au, label: a.filename,
            x: g?.x ?? 0.3, y: g?.y ?? 0.3, scale: g?.scale ?? 0.3,
            opacity: g?.opacity ?? 1, rotation: g?.rotation ?? 0, z: g?.z ?? 1,
            visible: g?.visible ?? Boolean(g),
          });
        }
        if (active) { setLayers(built); setTexts(state.texts || []); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load editor");
      }
    })();
    return () => { active = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id]);

  function patch(key: string, p: Partial<EditorLayer>) {
    setLayers((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function patchText(id: string, p: Partial<TextLayerState>) {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }

  function centerFrac(key: string): { cx: number; cy: number } {
    const box = wrapRefs.current[key]?.getBoundingClientRect();
    const stage = stageRef.current!.getBoundingClientRect();
    if (!box) return { cx: 0.5, cy: 0.5 };
    return { cx: (box.left + box.width / 2 - stage.left) / STAGE_W, cy: (box.top + box.height / 2 - stage.top) / stageH };
  }

  function startMove(e: React.PointerEvent, key: string, x: number, y: number, locked?: boolean) {
    if (locked) return;
    e.stopPropagation();
    setSelected(key);
    const rect = stageRef.current!.getBoundingClientRect();
    drag.current = { key, mode: "move", isText: key.startsWith("text:"), dx: e.clientX - rect.left - x * STAGE_W, dy: e.clientY - rect.top - y * stageH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: React.PointerEvent, key: string, startScale: number) {
    e.stopPropagation();
    const el = wrapRefs.current[key];
    if (!el) return;
    const box = el.getBoundingClientRect();
    const cxS = box.left + box.width / 2;
    const cyS = box.top + box.height / 2;
    const { cx, cy } = centerFrac(key);
    drag.current = { key, mode: "resize", isText: key.startsWith("text:"), cxFrac: cx, cyFrac: cy,
      startDist: Math.hypot(e.clientX - cxS, e.clientY - cyS) || 1, startScale, startW: el.offsetWidth, startH: el.offsetHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startRotate(e: React.PointerEvent, key: string, startRot: number) {
    e.stopPropagation();
    const box = wrapRefs.current[key]?.getBoundingClientRect();
    if (!box) return;
    const cxS = box.left + box.width / 2;
    const cyS = box.top + box.height / 2;
    const { cx, cy } = centerFrac(key);
    drag.current = { key, mode: "rotate", isText: key.startsWith("text:"), cxFrac: cx, cyFrac: cy,
      startAngle: Math.atan2(e.clientY - cyS, e.clientX - cxS), startRot };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const stage = stageRef.current!.getBoundingClientRect();

    if (d.mode === "move") {
      const x = Math.max(-0.4, Math.min(1.2, (e.clientX - stage.left - d.dx!) / STAGE_W));
      const y = Math.max(-0.4, Math.min(1.2, (e.clientY - stage.top - d.dy!) / stageH));
      if (d.isText) patchText(d.key.slice(5), { x, y });
      else patch(d.key, { x, y });
      return;
    }

    const cxS = stage.left + d.cxFrac! * STAGE_W;
    const cyS = stage.top + d.cyFrac! * stageH;

    if (d.mode === "resize") {
      const dist = Math.hypot(e.clientX - cxS, e.clientY - cyS);
      const ratio = dist / d.startDist!;
      const [min, max] = d.isText ? [0.02, 0.4] : [0.05, 1.5];
      const newScale = Math.max(min, Math.min(max, d.startScale! * ratio));
      const grow = newScale / d.startScale!;
      const newW = d.startW! * grow;
      const newH = d.startH! * grow;
      const x = d.cxFrac! - newW / 2 / STAGE_W;
      const y = d.cyFrac! - newH / 2 / stageH;
      if (d.isText) patchText(d.key.slice(5), { size: newScale, x, y });
      else patch(d.key, { scale: newScale, x, y });
      return;
    }

    const ang = Math.atan2(e.clientY - cyS, e.clientX - cxS);
    let deg = Math.round(d.startRot! + ((ang - d.startAngle!) * 180) / Math.PI);
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      if (Math.abs(deg - snap) <= 3) deg = snap;
    }
    if (d.isText) patchText(d.key.slice(5), { rotation: deg });
    else patch(d.key, { rotation: deg });
  }

  function addText() {
    const t: TextLayerState = {
      id: crypto.randomUUID(), text: "Your text", x: 0.1, y: 0.45, size: 0.06,
      color: "#ffffff", font: "sans", bold: true, italic: false, rotation: 0,
      opacity: 1, z: texts.length + 1, visible: true,
    };
    setTexts((prev) => [...prev, t]);
    setSelected(`text:${t.id}`);
  }

  function removeText(id: string) {
    setTexts((prev) => prev.filter((t) => t.id !== id));
    setSelected((s) => (s === `text:${id}` ? null : s));
  }

  function onPointerUp() { drag.current = null; }

  function renderHandles(key: string, scale: number, rotation: number) {
    return (
      <>
        <div className="absolute left-1/2 top-0 z-[1] h-[25px] w-0.5 -translate-x-1/2 -translate-y-[25px] bg-primary" />
        <div className={cn(HANDLE_BASE, HANDLE_CORNERS.rotate)} onPointerDown={(e) => startRotate(e, key, rotation)} title="Drag to rotate" />
        <div className={cn(HANDLE_BASE, HANDLE_CORNERS.tl)} onPointerDown={(e) => startResize(e, key, scale)} />
        <div className={cn(HANDLE_BASE, HANDLE_CORNERS.tr)} onPointerDown={(e) => startResize(e, key, scale)} />
        <div className={cn(HANDLE_BASE, HANDLE_CORNERS.bl)} onPointerDown={(e) => startResize(e, key, scale)} />
        <div className={cn(HANDLE_BASE, HANDLE_CORNERS.br)} onPointerDown={(e) => startResize(e, key, scale)} />
      </>
    );
  }

  function reorder(key: string, dir: 1 | -1) {
    setLayers((prev) => {
      const assetLayers = prev.filter((l) => l.kind === "asset").sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      const idx = assetLayers.findIndex((l) => l.key === key);
      const swap = idx + dir;
      if (swap < 0 || swap >= assetLayers.length) return prev;
      const a = assetLayers[idx];
      const b = assetLayers[swap];
      const az = a.z ?? 0;
      a.z = b.z ?? 0;
      b.z = az;
      return prev.map((l) => (l.key === a.key ? a : l.key === b.key ? b : l));
    });
  }

  async function uploadAsset(file: File) {
    setBusy("Uploading asset…"); setError("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const created = await api<PostAsset>(`/campaigns/${campaignId}/assets`, { method: "POST", formData: fd });
      const ab = await apiBlob(`/campaigns/${campaignId}/assets/${created.id}/file`);
      const au = URL.createObjectURL(ab);
      setAssets((prev) => [...prev, created]);
      setLayers((prev) => [...prev, {
        key: `asset:${created.id}`, kind: "asset", asset_id: created.id, url: au, label: created.filename,
        x: 0.3, y: 0.3, scale: 0.3, opacity: 1, rotation: 0,
        z: prev.filter((l) => l.kind === "asset").length + 1, visible: true,
      }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(""); }
  }

  function serialize(): CanvasState {
    const state: CanvasState = { assets: [], texts: texts.filter((t) => t.text.trim()) };
    for (const l of layers) {
      const geom: LayerGeom = { x: l.x, y: l.y, scale: l.scale, opacity: l.opacity, rotation: l.rotation ?? 0, visible: l.visible !== false };
      if (l.kind === "logo") state.logo = { ...geom, locked: l.locked ?? false };
      else state.assets!.push({ ...geom, asset_id: l.asset_id, z: l.z ?? 0 });
    }
    return state;
  }

  async function save() {
    setBusy("Saving…"); setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/canvas`, { method: "PUT", body: { canvas_state: serialize() } });
      onSaved();
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(""); }
  }

  async function downloadComposite() {
    setBusy("Preparing download…"); setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/canvas`, { method: "PUT", body: { canvas_state: serialize() } });
      onSaved();
      await downloadFile(`/campaigns/${campaignId}/images/${image.id}/composite`, `image-${image.aspect_ratio.replace(":", "x")}.png`);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(""); }
  }

  const sel = layers.find((l) => l.key === selected) || null;
  const selText = selected?.startsWith("text:") ? texts.find((t) => t.id === selected.slice(5)) || null : null;
  const ordered = [...layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[900px] flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="m-0 text-xl font-semibold">Image Editor</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={downloadComposite} disabled={!!busy}>
              ⬇ Download
            </Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
        {error && (
          <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
          <div
            ref={stageRef}
            style={{ width: STAGE_W, height: stageH }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative flex-shrink-0 touch-none overflow-hidden rounded-lg bg-slate-200 select-none"
          >
            {baseUrl && (
              <img
                src={baseUrl} alt="base" draggable={false}
                onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth) setBaseAspect(img.naturalHeight / img.naturalWidth); }}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              />
            )}
            {ordered.filter((l) => l.visible !== false).map((l) => {
              const isSel = selected === l.key;
              return (
                <div
                  key={l.key}
                  ref={(el) => { wrapRefs.current[l.key] = el; }}
                  onPointerDown={(e) => startMove(e, l.key, l.x, l.y, l.locked)}
                  className={cn(
                    "absolute cursor-grab touch-none outline outline-1 outline-dashed outline-transparent transition-[outline-color] active:cursor-grabbing",
                    isSel && "outline-primary outline-[1.5px]",
                    l.locked && "cursor-not-allowed",
                  )}
                  style={{ left: l.x * STAGE_W, top: l.y * stageH, width: l.scale * STAGE_W, transform: `rotate(${l.rotation ?? 0}deg)`, transformOrigin: "center center" }}
                >
                  <img src={l.url} alt={l.label} draggable={false} className="pointer-events-none block h-auto w-full select-none" style={{ opacity: l.opacity }} />
                  {isSel && !l.locked && renderHandles(l.key, l.scale, l.rotation ?? 0)}
                </div>
              );
            })}
            {texts.filter((t) => t.visible !== false).map((t) => {
              const key = `text:${t.id}`;
              const isSel = selected === key;
              return (
                <div
                  key={t.id}
                  ref={(el) => { wrapRefs.current[key] = el; }}
                  onPointerDown={(e) => startMove(e, key, t.x, t.y)}
                  className={cn("absolute cursor-grab touch-none outline outline-1 outline-dashed outline-transparent transition-[outline-color] active:cursor-grabbing", isSel && "outline-primary outline-[1.5px]")}
                  style={{ left: t.x * STAGE_W, top: t.y * stageH, transform: `rotate(${t.rotation ?? 0}deg)`, transformOrigin: "center center" }}
                >
                  <div
                    className="pointer-events-none select-none"
                    style={{ fontSize: t.size * STAGE_W, color: t.color, fontFamily: TEXT_FONTS[t.font] || TEXT_FONTS.sans, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal", opacity: t.opacity, whiteSpace: "pre", lineHeight: 1.2 }}
                  >
                    {t.text}
                  </div>
                  {isSel && renderHandles(key, t.size, t.rotation ?? 0)}
                </div>
              );
            })}
          </div>

          <div className="flex min-w-[240px] flex-col gap-3">
            <Button asChild variant="ghost">
              <label className="flex cursor-pointer items-center gap-1.5">
                <Plus size={14} /> Upload asset
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden
                  onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0])} />
              </label>
            </Button>
            <Button variant="ghost" onClick={addText}>
              <Plus size={14} /> Add text
            </Button>

            <div className="flex flex-col gap-0.5">
              {ordered.slice().reverse().map((l) => (
                <div
                  key={l.key}
                  className={cn("flex cursor-pointer items-center justify-between rounded-md border border-border p-1.5", selected === l.key && "border-primary bg-accent")}
                  onClick={() => { setSelected(l.key); if (l.visible === false) patch(l.key, { visible: true }); }}
                >
                  <span className="max-w-[130px] truncate text-sm">{l.label}</span>
                  <div className="flex gap-0.5">
                    <button
                      className="cursor-pointer rounded p-0.5 text-base hover:bg-bg"
                      title="Toggle visibility"
                      onClick={(e) => { e.stopPropagation(); patch(l.key, { visible: l.visible === false }); }}
                    >
                      {l.visible === false ? "🚫" : "👁"}
                    </button>
                    {l.kind === "asset" && (
                      <>
                        <button className="cursor-pointer rounded p-0.5 text-base hover:bg-bg" title="Bring forward" aria-label="Bring layer forward" onClick={(e) => { e.stopPropagation(); reorder(l.key, 1); }}>↑</button>
                        <button className="cursor-pointer rounded p-0.5 text-base hover:bg-bg" title="Send backward" aria-label="Send layer backward" onClick={(e) => { e.stopPropagation(); reorder(l.key, -1); }}>↓</button>
                      </>
                    )}
                    {l.kind === "logo" && (
                      <button
                        className="cursor-pointer rounded p-0.5 text-base hover:bg-bg"
                        title="Lock position"
                        onClick={(e) => { e.stopPropagation(); patch(l.key, { locked: !l.locked }); }}
                      >
                        {l.locked ? "🔒" : "🔓"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {texts.map((t) => (
                <div
                  key={t.id}
                  className={cn("flex cursor-pointer items-center justify-between rounded-md border border-border p-1.5", selected === `text:${t.id}` && "border-primary bg-accent")}
                  onClick={() => { setSelected(`text:${t.id}`); if (t.visible === false) patchText(t.id, { visible: true }); }}
                >
                  <span className="max-w-[130px] truncate text-sm">T: {t.text.slice(0, 18) || "(empty)"}</span>
                  <div className="flex gap-0.5">
                    <button
                      className="cursor-pointer rounded p-0.5 text-base hover:bg-bg"
                      title="Toggle visibility"
                      onClick={(e) => { e.stopPropagation(); patchText(t.id, { visible: t.visible === false }); }}
                    >
                      {t.visible === false ? "🚫" : "👁"}
                    </button>
                    <button
                      className="cursor-pointer rounded p-0.5 text-base hover:bg-bg"
                      title="Delete text"
                      onClick={(e) => { e.stopPropagation(); removeText(t.id); }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
              {layers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {client.logo_object_key ? "Loading layers…" : "This client has no logo. Upload assets to overlay."}
                </p>
              )}
            </div>

            {sel && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
                <strong className="text-sm font-semibold">{sel.label}</strong>
                <p className="m-0 text-sm text-muted-foreground">Drag the image to move · pull a corner to resize · use the top handle to rotate.</p>
                <Label className="text-sm">Opacity: {Math.round(sel.opacity * 100)}%
                  <Input type="range" min={0} max={100} value={Math.round(sel.opacity * 100)}
                    onChange={(e) => patch(sel.key, { opacity: Number(e.target.value) / 100 })} />
                </Label>
              </div>
            )}

            {selText && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
                <strong className="text-sm font-semibold">Text layer</strong>
                <Label className="text-sm">Text
                  <TextareaZoom label="Text" rows={2} value={selText.text} onChange={(v) => patchText(selText.id, { text: v })} />
                </Label>
                <div className="flex items-center gap-2">
                  <Label className="flex-1 text-sm">Font
                    <select
                      value={selText.font}
                      onChange={(e) => patchText(selText.id, { font: e.target.value as TextLayerState["font"] })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="sans">Sans-serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                    </select>
                  </Label>
                  <Label className="text-sm">Color
                    <Input type="color" value={selText.color} onChange={(e) => patchText(selText.id, { color: e.target.value })} className="h-[30px] w-[42px] cursor-pointer rounded-md border border-border p-0.5" />
                  </Label>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="ghost" className={cn(selText.bold && "border-primary text-primary bg-accent")} style={{ fontWeight: 700 }} onClick={() => patchText(selText.id, { bold: !selText.bold })}>B</Button>
                  <Button variant="ghost" className={cn(selText.italic && "border-primary text-primary bg-accent")} style={{ fontStyle: "italic" }} onClick={() => patchText(selText.id, { italic: !selText.italic })}>I</Button>
                </div>
                <p className="m-0 text-sm text-muted-foreground">Drag the text to move · pull a corner to resize · use the top handle to rotate.</p>
                <Label className="text-sm">Opacity: {Math.round(selText.opacity * 100)}%
                  <Input type="range" min={0} max={100} value={Math.round(selText.opacity * 100)}
                    onChange={(e) => patchText(selText.id, { opacity: Number(e.target.value) / 100 })} />
                </Label>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2 border-t border-border pt-4">
          <Button onClick={save} disabled={!!busy}>{busy || "Save composition"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
