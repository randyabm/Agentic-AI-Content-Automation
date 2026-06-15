import { useEffect, useRef, useState } from "react";
import { api, apiBlob, downloadFile } from "../api";
import { TextareaZoom } from "./TextareaZoom";
import type { CanvasState, Client, LayerGeom, PostAsset, PostImage, TextLayerState } from "../types";

const STAGE_W = 460;

function ratioToHeight(aspect: string, width: number): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return width;
  return Math.round((width * h) / w);
}

interface EditorLayer extends LayerGeom {
  key: string;           // logo | asset:<id>
  kind: "logo" | "asset";
  url: string;           // object URL for display
  label: string;
}

// CSS stacks matching the backend's DejaVu families so preview ≈ export.
const TEXT_FONTS: Record<TextLayerState["font"], string> = {
  sans: "'DejaVu Sans', Verdana, Arial, sans-serif",
  serif: "'DejaVu Serif', Georgia, serif",
  mono: "'DejaVu Sans Mono', 'Courier New', monospace",
};

export function ImageEditor({
  campaignId,
  image,
  client,
  onClose,
  onSaved,
}: {
  campaignId: string;
  image: PostImage;
  client: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  // Real aspect (h/w) of the loaded base image, so the stage matches the picture
  // exactly and nothing is cropped — overlays stay aligned with the export.
  const [baseAspect, setBaseAspect] = useState(0);
  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const [texts, setTexts] = useState<TextLayerState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<PostAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Direct-manipulation gesture: drag to move, corner handles to resize, top
  // handle to rotate — all on the canvas, no sliders for size/rotation.
  const drag = useRef<
    | {
        key: string;
        mode: "move" | "resize" | "rotate";
        isText: boolean;
        // move
        dx?: number;
        dy?: number;
        // resize / rotate share a fixed center (in stage fractions)
        cxFrac?: number;
        cyFrac?: number;
        // resize
        startDist?: number;
        startScale?: number;
        startW?: number;
        startH?: number;
        // rotate
        startAngle?: number;
        startRot?: number;
      }
    | null
  >(null);

  const stageH = baseAspect > 0 ? Math.round(STAGE_W * baseAspect) : ratioToHeight(image.aspect_ratio, STAGE_W);

  // Load base image, logo, and campaign assets, then rebuild layers from canvas_state.
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
            key: "logo",
            kind: "logo",
            url: lu,
            label: "Logo",
            x: g?.x ?? 0.05,
            y: g?.y ?? 0.05,
            scale: g?.scale ?? 0.25,
            opacity: g?.opacity ?? 1,
            rotation: g?.rotation ?? 0,
            locked: g?.locked ?? false,
            // Visible by default: placing the logo is the editor's main purpose (§5.5.1).
            visible: g?.visible ?? true,
            z: 999,
          });
        }

        for (const a of assetList) {
          const ab = await apiBlob(`/campaigns/${campaignId}/assets/${a.id}/file`);
          const au = URL.createObjectURL(ab);
          urls.push(au);
          const g = (state.assets || []).find((s) => s.asset_id === a.id);
          built.push({
            key: `asset:${a.id}`,
            kind: "asset",
            asset_id: a.id,
            url: au,
            label: a.filename,
            x: g?.x ?? 0.3,
            y: g?.y ?? 0.3,
            scale: g?.scale ?? 0.3,
            opacity: g?.opacity ?? 1,
            rotation: g?.rotation ?? 0,
            z: g?.z ?? 1,
            visible: g?.visible ?? Boolean(g),
          });
        }
        if (active) {
          setLayers(built);
          setTexts(state.texts || []);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load editor");
      }
    })();
    return () => {
      active = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id]);

  function patch(key: string, p: Partial<EditorLayer>) {
    setLayers((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }

  function patchText(id: string, p: Partial<TextLayerState>) {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }

  // --- Direct manipulation: move / resize (corners) / rotate (top handle) ---

  function centerFrac(key: string): { cx: number; cy: number } {
    const box = wrapRefs.current[key]?.getBoundingClientRect();
    const stage = stageRef.current!.getBoundingClientRect();
    if (!box) return { cx: 0.5, cy: 0.5 };
    return {
      cx: (box.left + box.width / 2 - stage.left) / STAGE_W,
      cy: (box.top + box.height / 2 - stage.top) / stageH,
    };
  }

  function startMove(e: React.PointerEvent, key: string, x: number, y: number, locked?: boolean) {
    if (locked) return;
    e.stopPropagation();
    setSelected(key);
    const rect = stageRef.current!.getBoundingClientRect();
    drag.current = {
      key,
      mode: "move",
      isText: key.startsWith("text:"),
      dx: e.clientX - rect.left - x * STAGE_W,
      dy: e.clientY - rect.top - y * stageH,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: React.PointerEvent, key: string, startScale: number) {
    e.stopPropagation();
    const el = wrapRefs.current[key];
    if (!el) return;
    const box = el.getBoundingClientRect(); // center (rotation-invariant)
    const cxS = box.left + box.width / 2;
    const cyS = box.top + box.height / 2;
    const { cx, cy } = centerFrac(key);
    drag.current = {
      key,
      mode: "resize",
      isText: key.startsWith("text:"),
      cxFrac: cx,
      cyFrac: cy,
      startDist: Math.hypot(e.clientX - cxS, e.clientY - cyS) || 1,
      startScale,
      // Layout box (ignores the rotate transform) so the kept-fixed center is exact.
      startW: el.offsetWidth,
      startH: el.offsetHeight,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startRotate(e: React.PointerEvent, key: string, startRot: number) {
    e.stopPropagation();
    const box = wrapRefs.current[key]?.getBoundingClientRect();
    if (!box) return;
    const cxS = box.left + box.width / 2;
    const cyS = box.top + box.height / 2;
    const { cx, cy } = centerFrac(key);
    drag.current = {
      key,
      mode: "rotate",
      isText: key.startsWith("text:"),
      cxFrac: cx,
      cyFrac: cy,
      startAngle: Math.atan2(e.clientY - cyS, e.clientX - cxS),
      startRot,
    };
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

    // rotate
    const ang = Math.atan2(e.clientY - cyS, e.clientX - cxS);
    let deg = Math.round(d.startRot! + ((ang - d.startAngle!) * 180) / Math.PI);
    deg = ((deg + 180) % 360 + 360) % 360 - 180; // normalize to (-180, 180]
    for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      if (Math.abs(deg - snap) <= 3) deg = snap;
    }
    if (d.isText) patchText(d.key.slice(5), { rotation: deg });
    else patch(d.key, { rotation: deg });
  }

  function addText() {
    const t: TextLayerState = {
      id: crypto.randomUUID(),
      text: "Your text",
      x: 0.1,
      y: 0.45,
      size: 0.06,
      color: "#ffffff",
      font: "sans",
      bold: true,
      italic: false,
      rotation: 0,
      opacity: 1,
      z: texts.length + 1,
      visible: true,
    };
    setTexts((prev) => [...prev, t]);
    setSelected(`text:${t.id}`);
  }

  function removeText(id: string) {
    setTexts((prev) => prev.filter((t) => t.id !== id));
    setSelected((s) => (s === `text:${id}` ? null : s));
  }

  function onPointerUp() {
    drag.current = null;
  }

  // Selection chrome: four corner handles (resize) + a top handle (rotate).
  function renderHandles(key: string, scale: number, rotation: number) {
    return (
      <>
        <div className="rot-arm" />
        <div className="ed-handle rotate" onPointerDown={(e) => startRotate(e, key, rotation)} title="Drag to rotate" />
        <div className="ed-handle tl" onPointerDown={(e) => startResize(e, key, scale)} />
        <div className="ed-handle tr" onPointerDown={(e) => startResize(e, key, scale)} />
        <div className="ed-handle bl" onPointerDown={(e) => startResize(e, key, scale)} />
        <div className="ed-handle br" onPointerDown={(e) => startResize(e, key, scale)} />
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
    setBusy("Uploading asset…");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const created = await api<PostAsset>(`/campaigns/${campaignId}/assets`, { method: "POST", formData: fd });
      const ab = await apiBlob(`/campaigns/${campaignId}/assets/${created.id}/file`);
      const au = URL.createObjectURL(ab);
      setAssets((prev) => [...prev, created]);
      setLayers((prev) => [
        ...prev,
        {
          key: `asset:${created.id}`,
          kind: "asset",
          asset_id: created.id,
          url: au,
          label: created.filename,
          x: 0.3,
          y: 0.3,
          scale: 0.3,
          opacity: 1,
          rotation: 0,
          z: prev.filter((l) => l.kind === "asset").length + 1,
          visible: true,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy("");
    }
  }

  function serialize(): CanvasState {
    const state: CanvasState = { assets: [], texts: texts.filter((t) => t.text.trim()) };
    for (const l of layers) {
      const geom: LayerGeom = {
        x: l.x,
        y: l.y,
        scale: l.scale,
        opacity: l.opacity,
        rotation: l.rotation ?? 0,
        visible: l.visible !== false,
      };
      if (l.kind === "logo") {
        state.logo = { ...geom, locked: l.locked ?? false };
      } else {
        state.assets!.push({ ...geom, asset_id: l.asset_id, z: l.z ?? 0 });
      }
    }
    return state;
  }

  async function save() {
    setBusy("Saving…");
    setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/canvas`, {
        method: "PUT",
        body: { canvas_state: serialize() },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  // Persist the current canvas, then download the freshly composited PNG so the
  // file reflects exactly what's on screen (logo + assets + text).
  async function downloadComposite() {
    setBusy("Preparing download…");
    setError("");
    try {
      await api(`/campaigns/${campaignId}/images/${image.id}/canvas`, {
        method: "PUT",
        body: { canvas_state: serialize() },
      });
      onSaved();
      await downloadFile(
        `/campaigns/${campaignId}/images/${image.id}/composite`,
        `image-${image.aspect_ratio.replace(":", "x")}.png`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  const sel = layers.find((l) => l.key === selected) || null;
  const selText = selected?.startsWith("text:") ? texts.find((t) => t.id === selected.slice(5)) || null : null;
  const ordered = [...layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Image Editor</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={downloadComposite} disabled={!!busy}>
              ⬇ Download
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="editor-layout">
          <div
            className="editor-stage"
            ref={stageRef}
            style={{ width: STAGE_W, height: stageH }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {baseUrl && (
              <img
                className="editor-base"
                src={baseUrl}
                alt="base"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth) setBaseAspect(img.naturalHeight / img.naturalWidth);
                }}
              />
            )}
            {ordered
              .filter((l) => l.visible !== false)
              .map((l) => {
                const isSel = selected === l.key;
                return (
                  <div
                    key={l.key}
                    ref={(el) => {
                      wrapRefs.current[l.key] = el;
                    }}
                    onPointerDown={(e) => startMove(e, l.key, l.x, l.y, l.locked)}
                    className={`editor-layer-wrap ${isSel ? "selected" : ""} ${l.locked ? "locked" : ""}`}
                    style={{
                      left: l.x * STAGE_W,
                      top: l.y * stageH,
                      width: l.scale * STAGE_W,
                      transform: `rotate(${l.rotation ?? 0}deg)`,
                    }}
                  >
                    <img
                      src={l.url}
                      alt={l.label}
                      draggable={false}
                      className="editor-layer-img"
                      style={{ opacity: l.opacity }}
                    />
                    {isSel && !l.locked && renderHandles(l.key, l.scale, l.rotation ?? 0)}
                  </div>
                );
              })}
            {texts
              .filter((t) => t.visible !== false)
              .map((t) => {
                const key = `text:${t.id}`;
                const isSel = selected === key;
                return (
                  <div
                    key={t.id}
                    ref={(el) => {
                      wrapRefs.current[key] = el;
                    }}
                    onPointerDown={(e) => startMove(e, key, t.x, t.y)}
                    className={`editor-layer-wrap text ${isSel ? "selected" : ""}`}
                    style={{
                      left: t.x * STAGE_W,
                      top: t.y * stageH,
                      transform: `rotate(${t.rotation ?? 0}deg)`,
                    }}
                  >
                    <div
                      className="editor-text-content"
                      style={{
                        fontSize: t.size * STAGE_W,
                        color: t.color,
                        fontFamily: TEXT_FONTS[t.font] || TEXT_FONTS.sans,
                        fontWeight: t.bold ? 700 : 400,
                        fontStyle: t.italic ? "italic" : "normal",
                        opacity: t.opacity,
                        whiteSpace: "pre",
                        lineHeight: 1.2,
                      }}
                    >
                      {t.text}
                    </div>
                    {isSel && renderHandles(key, t.size, t.rotation ?? 0)}
                  </div>
                );
              })}
          </div>

          <div className="editor-panel">
            <label className="file-btn btn btn-ghost">
              + Upload asset
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0])}
              />
            </label>
            <button className="btn btn-ghost" onClick={addText}>
              + Add text
            </button>

            <div className="layer-list">
              {ordered
                .slice()
                .reverse()
                .map((l) => (
                  <div
                    key={l.key}
                    className={`layer-row ${selected === l.key ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(l.key);
                      if (l.visible === false) patch(l.key, { visible: true });
                    }}
                  >
                    <span className="layer-name">{l.label}</span>
                    <div className="layer-actions">
                      <button
                        className="btn-icon"
                        title="Toggle visibility"
                        onClick={(e) => {
                          e.stopPropagation();
                          patch(l.key, { visible: l.visible === false });
                        }}
                      >
                        {l.visible === false ? "🚫" : "👁"}
                      </button>
                      {l.kind === "asset" && (
                        <>
                          <button className="btn-icon" title="Bring forward" onClick={(e) => { e.stopPropagation(); reorder(l.key, 1); }}>
                            ↑
                          </button>
                          <button className="btn-icon" title="Send backward" onClick={(e) => { e.stopPropagation(); reorder(l.key, -1); }}>
                            ↓
                          </button>
                        </>
                      )}
                      {l.kind === "logo" && (
                        <button
                          className="btn-icon"
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
                  className={`layer-row ${selected === `text:${t.id}` ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(`text:${t.id}`);
                    if (t.visible === false) patchText(t.id, { visible: true });
                  }}
                >
                  <span className="layer-name">T: {t.text.slice(0, 18) || "(empty)"}</span>
                  <div className="layer-actions">
                    <button
                      className="btn-icon"
                      title="Toggle visibility"
                      onClick={(e) => {
                        e.stopPropagation();
                        patchText(t.id, { visible: t.visible === false });
                      }}
                    >
                      {t.visible === false ? "🚫" : "👁"}
                    </button>
                    <button
                      className="btn-icon"
                      title="Delete text"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeText(t.id);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
              {layers.length === 0 && (
                <p className="muted small">
                  {client.logo_object_key ? "Loading layers…" : "This client has no logo. Upload assets to overlay."}
                </p>
              )}
            </div>

            {sel && (
              <div className="layer-controls">
                <strong className="small">{sel.label}</strong>
                <p className="muted small" style={{ margin: 0 }}>
                  Drag the image to move · pull a corner to resize · use the top handle to rotate.
                </p>
                <label className="small">
                  Opacity: {Math.round(sel.opacity * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(sel.opacity * 100)}
                    onChange={(e) => patch(sel.key, { opacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            )}

            {selText && (
              <div className="layer-controls">
                <strong className="small">Text layer</strong>
                <label className="small">
                  Text
                  <TextareaZoom
                    label="Text"
                    rows={2}
                    value={selText.text}
                    onChange={(v) => patchText(selText.id, { text: v })}
                  />
                </label>
                <div className="row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label className="small" style={{ flex: 1 }}>
                    Font
                    <select
                      value={selText.font}
                      onChange={(e) => patchText(selText.id, { font: e.target.value as TextLayerState["font"] })}
                    >
                      <option value="sans">Sans-serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                    </select>
                  </label>
                  <label className="small">
                    Color
                    <input
                      type="color"
                      value={selText.color}
                      onChange={(e) => patchText(selText.id, { color: e.target.value })}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className={`btn btn-ghost ${selText.bold ? "active" : ""}`}
                    style={{ fontWeight: 700 }}
                    onClick={() => patchText(selText.id, { bold: !selText.bold })}
                  >
                    B
                  </button>
                  <button
                    className={`btn btn-ghost ${selText.italic ? "active" : ""}`}
                    style={{ fontStyle: "italic" }}
                    onClick={() => patchText(selText.id, { italic: !selText.italic })}
                  >
                    I
                  </button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Drag the text to move · pull a corner to resize · use the top handle to rotate.
                </p>
                <label className="small">
                  Opacity: {Math.round(selText.opacity * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selText.opacity * 100)}
                    onChange={(e) => patchText(selText.id, { opacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions form-actions">
          <button className="btn btn-primary" onClick={save} disabled={!!busy}>
            {busy || "Save composition"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
