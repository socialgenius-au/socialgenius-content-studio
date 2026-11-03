"""Not a test (leading underscore): measures what a behind-footage shape costs on a real render. Run: python tests/_optc_timing.py"""
import asyncio, subprocess, sys, tempfile, time, tracemalloc
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402
from app.services import ffmpeg_svc  # noqa: E402

tmp = Path(tempfile.mkdtemp())
settings.UPLOAD_DIR = str(tmp)


def clip(name, w, h, secs=10):
    out = tmp / name
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=red:s={w}x{h}:d={secs}:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return str(out)


def project(path, shapes):
    return {"canvas_width": 1080, "canvas_height": 1920, "video_clips": [{"path": path, "trim_in": 0, "start_time": 0, "end_time": 10, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False}], "text_overlays": [], "audio_tracks": [], "shapes": shapes}


def shape(behind):
    d = {"kind": "rectangle", "start_time": 0, "end_time": 10, "x": 0, "y": 0, "width": 100, "height": 100, "fill_color": "#ffff00", "opacity": 1.0, "border_color": None, "border_width": 0, "border_radius": 0, "full_width": False, "order": 0}
    if behind:
        d["behind_footage"] = True
    return d


async def timed(p):
    t = time.perf_counter()
    out = await ffmpeg_svc.render_project(p, 1)
    return time.perf_counter() - t, Path(out).stat().st_size


async def main():
    src = clip("wide.mp4", 1280, 720)
    base, size0 = await timed(project(src, []))
    ordinary, size1 = await timed(project(src, [shape(False)]))
    behind, size2 = await timed(project(src, [shape(True)]))
    tracemalloc.start()
    await timed(project(src, [shape(True)]))
    _cur, peak = tracemalloc.get_traced_memory()
    print(f"10 s 1080x1920 export from a 1280x720 clip (seconds / MB): no shape {base:.1f} s {size0/1e6:.2f} MB | one ordinary shape {ordinary:.1f} s {size1/1e6:.2f} MB | one behind-footage shape {behind:.1f} s {size2/1e6:.2f} MB")
    print(f"extra over an ordinary shape: {behind - ordinary:+.1f} s; Python-side peak allocation for the behind shape (Pillow + planning): {peak/1e6:.1f} MB")

asyncio.run(main())
