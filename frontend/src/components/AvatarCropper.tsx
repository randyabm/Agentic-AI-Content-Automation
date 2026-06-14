import { useEffect, useRef, useState } from "react";

/**
 * Circular avatar cropper. Lets the user pan (drag) and zoom a freshly picked
 * image inside a square/circle viewport, then exports a centred 512×512 PNG.
 */
export function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [src, setSrc] = useState("");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(320);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Load the picked file into an <img> for measurement + drawing.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = img ? Math.max(view / img.naturalWidth, view / img.naturalHeight) : 1;
  const dispScale = baseScale * zoom;
  const dispW = img ? img.naturalWidth * dispScale : 0;
  const dispH = img ? img.naturalHeight * dispScale : 0;

  function clamp(o: { x: number; y: number }, w = dispW, h = dispH) {
    return {
      x: Math.min(0, Math.max(view - w, o.x)),
      y: Math.min(0, Math.max(view - h, o.y)),
    };
  }

  // Measure the viewport and centre the image once it loads.
  useEffect(() => {
    if (!img || !viewRef.current) return;
    const v = viewRef.current.clientWidth;
    setView(v);
    const bs = Math.max(v / img.naturalWidth, v / img.naturalHeight);
    setOffset({ x: (v - img.naturalWidth * bs) / 2, y: (v - img.naturalHeight * bs) / 2 });
  }, [img]);

  // Keep the image covering the viewport when zoom changes.
  useEffect(() => {
    setOffset((o) => clamp(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function onDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setOffset(
      clamp({
        x: drag.current.ox + (e.clientX - drag.current.x),
        y: drag.current.oy + (e.clientY - drag.current.y),
      }),
    );
  }
  function onUp() {
    drag.current = null;
  }

  function confirm() {
    if (!img) return;
    const out = 512;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sSize = view / dispScale; // source square that maps to the viewport
    ctx.drawImage(img, -offset.x / dispScale, -offset.y / dispScale, sSize, sSize, 0, 0, out, out);
    canvas.toBlob((b) => b && onConfirm(b), "image/png");
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal cropper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Adjust profile photo</h2>
          <button className="btn btn-ghost" onClick={onCancel}>
            ✕ Cancel
          </button>
        </div>
        <p className="muted small">Drag to reposition, slide to zoom.</p>

        <div
          className="cropper-view"
          ref={viewRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {src && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{ position: "absolute", left: offset.x, top: offset.y, width: dispW, height: dispH }}
            />
          )}
          <div className="cropper-ring" />
        </div>

        <div className="cropper-zoom">
          <span aria-hidden>🔍</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={confirm} disabled={!img}>
            Save photo
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
