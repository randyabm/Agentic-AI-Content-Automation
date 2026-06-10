import { useEffect, useRef, useState } from "react";
import { api, apiBlob } from "../api";
import type { CanvasState, Client, LayerGeom, PostAsset, PostImage } from "../types";

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
  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<PostAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);

  const stageH = ratioToHeight(image.aspect_ratio, STAGE_W);

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
            visible: g?.visible ?? Boolean(state.logo),
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
        if (active) setLayers(built);
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

  function onPointerDown(e: React.PointerEvent, layer: EditorLayer) {
    if (layer.locked) return;
    setSelected(layer.key);
    const rect = stageRef.current!.getBoundingClientRect();
    drag.current = {
      key: layer.key,
      dx: e.clientX - rect.left - layer.x * STAGE_W,
      dy: e.clientY - rect.top - layer.y * stageH,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const rect = stageRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left - drag.current.dx) / STAGE_W;
    const y = (e.clientY - rect.top - drag.current.dy) / stageH;
    patch(drag.current.key, { x: Math.max(-0.2, Math.min(1, x)), y: Math.max(-0.2, Math.min(1, y)) });
  }

  function onPointerUp() {
    drag.current = null;
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
    const state: CanvasState = { assets: [] };
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

  const sel = layers.find((l) => l.key === selected) || null;
  const ordered = [...layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Image Editor</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
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
            {baseUrl && <img className="editor-base" src={baseUrl} alt="base" draggable={false} />}
            {ordered
              .filter((l) => l.visible !== false)
              .map((l) => (
                <img
                  key={l.key}
                  src={l.url}
                  alt={l.label}
                  draggable={false}
                  onPointerDown={(e) => onPointerDown(e, l)}
                  className={`editor-layer ${selected === l.key ? "selected" : ""} ${l.locked ? "locked" : ""}`}
                  style={{
                    left: l.x * STAGE_W,
                    top: l.y * stageH,
                    width: l.scale * STAGE_W,
                    opacity: l.opacity,
                    transform: `rotate(${l.rotation ?? 0}deg)`,
                  }}
                />
              ))}
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

            <div className="layer-list">
              {ordered
                .slice()
                .reverse()
                .map((l) => (
                  <div
                    key={l.key}
                    className={`layer-row ${selected === l.key ? "selected" : ""}`}
                    onClick={() => setSelected(l.key)}
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
              {layers.length === 0 && (
                <p className="muted small">
                  {client.logo_object_key ? "Loading layers…" : "This client has no logo. Upload assets to overlay."}
                </p>
              )}
            </div>

            {sel && (
              <div className="layer-controls">
                <strong className="small">{sel.label}</strong>
                <label className="small">
                  Size: {Math.round(sel.scale * 100)}%
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={Math.round(sel.scale * 100)}
                    onChange={(e) => patch(sel.key, { scale: Number(e.target.value) / 100 })}
                  />
                </label>
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
                <label className="small">
                  Rotation: {sel.rotation ?? 0}°
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={sel.rotation ?? 0}
                    onChange={(e) => patch(sel.key, { rotation: Number(e.target.value) })}
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
