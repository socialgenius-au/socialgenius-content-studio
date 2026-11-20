"""Deterministic image enhancements for Video Studio.

These functions operate on image bytes only. They never call paid AI, modify an
original asset, write to disk, or pretend that foreground segmentation occurred.
"""
from io import BytesIO

from PIL import Image, ImageEnhance, ImageOps, UnidentifiedImageError

MAX_IMAGE_PIXELS = 24_000_000
MAX_INPUT_BYTES = 20 * 1024 * 1024


class ImageProcessingError(ValueError):
    pass


def enhance_image(image_bytes: bytes, *, contrast: float = 1.10,
                  color: float = 1.06, sharpness: float = 1.12) -> bytes:
    """Return an enhanced PNG, retaining transparency where present.

    Values are deliberately modest and bounded. This is a real deterministic
    enhancement, not an AI-generated result or a claimed restoration.
    """
    if not image_bytes or len(image_bytes) > MAX_INPUT_BYTES:
        raise ImageProcessingError("Image is empty or exceeds 20 MB")
    if not all(0.5 <= value <= 2.0 for value in (contrast, color, sharpness)):
        raise ImageProcessingError("Enhancement strengths must be between 0.5 and 2")
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ImageProcessingError("Image exceeds 24 megapixels")
            image = ImageOps.exif_transpose(source)
            image.load()
            image = image.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, ImageProcessingError):
            raise
        raise ImageProcessingError("Unsupported or damaged image") from exc
    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = ImageEnhance.Color(rgb).enhance(color)
    rgb = ImageEnhance.Sharpness(rgb).enhance(sharpness)
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    output = BytesIO()
    result.save(output, format="PNG", optimize=True)
    return output.getvalue()


def remove_flat_background(image_bytes: bytes, *, tolerance: int = 24) -> bytes:
    """Remove a near-uniform corner-connected background; NOT semantic AI segmentation.

    Flood-fill starts at the four corners. Only pixels connected to a corner
    and close in RGB to that corner's colour are made transparent. Complex
    scenes, gradients, and similarly coloured subjects require manual review.
    """
    from collections import deque

    if not image_bytes or len(image_bytes) > MAX_INPUT_BYTES:
        raise ImageProcessingError("Image is empty or exceeds 20 MB")
    if not 0 <= tolerance <= 80:
        raise ImageProcessingError("Tolerance must be between 0 and 80")
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ImageProcessingError("Image exceeds 24 megapixels")
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, ImageProcessingError):
            raise
        raise ImageProcessingError("Unsupported or damaged image") from exc
    width, height = image.size
    pixels = image.load()
    corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    seeds = [(x, y, pixels[x, y][:3]) for x, y in corners]
    seen = bytearray(width * height)
    queue = deque(seeds)
    while queue:
        x, y, target = queue.popleft()
        offset = y * width + x
        if seen[offset]:
            continue
        seen[offset] = 1
        rgba = pixels[x, y]
        if max(abs(rgba[i] - target[i]) for i in range(3)) > tolerance:
            continue
        pixels[x, y] = (rgba[0], rgba[1], rgba[2], 0)
        if x > 0:
            queue.append((x - 1, y, target))
        if x + 1 < width:
            queue.append((x + 1, y, target))
        if y > 0:
            queue.append((x, y - 1, target))
        if y + 1 < height:
            queue.append((x, y + 1, target))
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def remove_complex_background(image_bytes: bytes, *, margin_percent: int = 8) -> bytes:
    """Attempt foreground extraction with OpenCV GrabCut, without paid AI.

    Assumes the subject is central and background occupies the outer margin.
    Results are approximate, especially with hair, transparent objects or
    subjects touching the image edge. Always review the downloaded PNG.
    """
    import cv2
    import numpy as np

    if not image_bytes or len(image_bytes) > MAX_INPUT_BYTES:
        raise ImageProcessingError("Image is empty or exceeds 20 MB")
    if not 3 <= margin_percent <= 25:
        raise ImageProcessingError("Margin must be between 3 and 25 percent")
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            if source.width * source.height > 2_000_000:
                raise ImageProcessingError("Complex background removal supports up to 2 megapixels")
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, ImageProcessingError):
            raise
        raise ImageProcessingError("Unsupported or damaged image") from exc
    width, height = image.size
    if min(width, height) < 40:
        raise ImageProcessingError("Image must be at least 40 pixels on each side")
    x_margin = max(2, width * margin_percent // 100)
    y_margin = max(2, height * margin_percent // 100)
    rect = (x_margin, y_margin, width - 2 * x_margin, height - 2 * y_margin)
    rgb = np.asarray(image.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    mask = np.zeros((height, width), np.uint8)
    background_model = np.zeros((1, 65), np.float64)
    foreground_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, mask, rect, background_model, foreground_model, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error as exc:
        raise ImageProcessingError("Unable to isolate foreground in this image") from exc
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # Respect existing transparency rather than turning transparent pixels opaque.
    original_alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
    alpha = np.minimum(alpha, original_alpha)
    result = image.copy()
    result.putalpha(Image.fromarray(alpha, mode="L"))
    output = BytesIO()
    result.save(output, format="PNG", optimize=True)
    return output.getvalue()
