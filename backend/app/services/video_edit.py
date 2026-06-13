"""ffmpeg-backed video post-processing: overlay the client logo on a generated
clip and reframe a base clip to other aspect ratios locally (cheap, no re-gen).

All functions work on bytes via temp files and re-encode to H.264/yuv420p so the
result plays everywhere. ffmpeg is installed in the backend image.
"""
from __future__ import annotations

import io
import logging
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)


class VideoEditError(Exception):
    pass


def _even(n: float) -> int:
    n = int(round(n))
    return n - (n % 2)  # H.264 needs even dimensions


def _ratio_value(aspect_ratio: str) -> float:
    try:
        w, h = (float(p) for p in aspect_ratio.split(":"))
        return w / h if h else 1.0
    except ValueError:
        return 1.0


def _run(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True)
    if proc.returncode != 0:
        raise VideoEditError(proc.stderr.decode("utf-8", "ignore")[-400:])


def _probe_size(path: str) -> tuple[int, int]:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise VideoEditError(proc.stderr[-400:])
    w, h = proc.stdout.strip().split("x")
    return int(w), int(h)


def extract_first_frame(video_bytes: bytes) -> bytes:
    """Return the first frame of the clip as PNG bytes (for vision logo placement)."""
    with tempfile.TemporaryDirectory() as d:
        inp, out = f"{d}/in.mp4", f"{d}/frame.png"
        Path(inp).write_bytes(video_bytes)
        _run(["ffmpeg", "-y", "-i", inp, "-vframes", "1", out])
        return Path(out).read_bytes()


def overlay_logo(video_bytes: bytes, logo_bytes: bytes, geom: dict) -> bytes:
    """Overlay the logo onto every frame at the vision-decided spot.

    geom: {x, y, scale} as fractions (top-left x/y of video, width = scale·videoW).
    Returns the new MP4 bytes; on any ffmpeg failure returns the original clip.
    """
    try:
        # Normalise the logo to PNG (ffmpeg can't read SVG; Pillow can't either).
        logo_img = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001 — e.g. an SVG logo: skip overlay
        logger.warning("Logo not rasterisable for video overlay (%s); skipping", exc)
        return video_bytes

    with tempfile.TemporaryDirectory() as d:
        inp, logo_p, out = f"{d}/in.mp4", f"{d}/logo.png", f"{d}/out.mp4"
        Path(inp).write_bytes(video_bytes)
        logo_img.save(logo_p, format="PNG")
        try:
            w, h = _probe_size(inp)
            lw = max(8, _even(geom.get("scale", 0.18) * w))
            ox = max(0, int(round(geom.get("x", 0.7) * w)))
            oy = max(0, int(round(geom.get("y", 0.82) * h)))
            _run([
                "ffmpeg", "-y", "-i", inp, "-i", logo_p,
                "-filter_complex", f"[1:v]scale={lw}:-1[lg];[0:v][lg]overlay={ox}:{oy}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", out,
            ])
            return Path(out).read_bytes()
        except VideoEditError as exc:
            logger.warning("Logo overlay failed (%s); using clip without logo", exc)
            return video_bytes


def reframe_video(video_bytes: bytes, aspect_ratio: str) -> bytes:
    """Re-fit the clip to a new aspect ratio WITHOUT cropping: the whole original is

    centred at full size and the extra space is filled with a blurred, zoomed copy
    (matches the image pipeline). Returns new MP4 bytes.
    """
    with tempfile.TemporaryDirectory() as d:
        inp, out = f"{d}/in.mp4", f"{d}/out.mp4"
        Path(inp).write_bytes(video_bytes)
        w, h = _probe_size(inp)
        target = _ratio_value(aspect_ratio)
        if w / h > target:  # need a taller canvas → extend top/bottom
            cw, ch = _even(w), _even(max(h + 2, w / target))
        else:  # need a wider canvas → extend the sides
            cw, ch = _even(max(w + 2, h * target)), _even(h)
        fw, fh = _even(w), _even(h)
        flt = (
            f"[0:v]scale={cw}:{ch}:force_original_aspect_ratio=increase,"
            f"crop={cw}:{ch},gblur=sigma=20[bg];"
            f"[0:v]scale={fw}:{fh}[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
        )
        _run([
            "ffmpeg", "-y", "-i", inp, "-filter_complex", flt, "-map", "[v]",
            "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", out,
        ])
        return Path(out).read_bytes()
