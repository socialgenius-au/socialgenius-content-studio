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
