import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    if (!img || !viewRef.current) return;
    const v = viewRef.current.clientWidth;
    setView(v);
    const bs = Math.max(v / img.naturalWidth, v / img.naturalHeight);
    setOffset({ x: (v - img.naturalWidth * bs) / 2, y: (v - img.naturalHeight * bs) / 2 });
  }, [img]);

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
    const sSize = view / dispScale;
    ctx.drawImage(img, -offset.x / dispScale, -offset.y / dispScale, sSize, sSize, 0, 0, out, out);
    canvas.toBlob((b) => b && onConfirm(b), "image/png");
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-[420px] rounded-xl bg-surface p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="m-0 text-xl font-semibold">Adjust profile photo</h2>
          <Button variant="ghost" size="sm" onClick={onCancel}>✕ Cancel</Button>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">Drag to reposition, slide to zoom.</p>

        <div
          ref={viewRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          className="relative mx-auto mt-2 aspect-square w-full max-w-[340px] cursor-grab touch-none select-none overflow-hidden rounded-md bg-slate-900 active:cursor-grabbing"
        >
          {src && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none"
              style={{ position: "absolute", left: offset.x, top: offset.y, width: dispW, height: dispH }}
            />
          )}
          <div
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_2000px_rgba(15,23,42,0.55),inset_0_0_0_2px_rgba(255,255,255,0.9)]"
          />
        </div>

        <div className="mx-auto mt-3 flex max-w-[340px] items-center gap-2.5">
          <span aria-hidden>🔍</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button onClick={confirm} disabled={!img}>Save photo</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
