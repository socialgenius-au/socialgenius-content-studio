"""No-cost tests for actual image enhancement; never call an AI provider."""
from io import BytesIO

import pytest
from PIL import Image

from app.services.image_enhancement import ImageProcessingError, enhance_image


def _image() -> bytes:
    img = Image.new("RGBA", (24, 24), (80, 120, 160, 140))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_enhancement_produces_valid_png_and_keeps_alpha():
    result = enhance_image(_image())
    with Image.open(BytesIO(result)) as image:
        assert image.size == (24, 24)
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 140


def test_rejects_invalid_image():
    with pytest.raises(ImageProcessingError):
        enhance_image(b"not an image")


def test_rejects_out_of_range_strength():
    with pytest.raises(ImageProcessingError):
        enhance_image(_image(), contrast=20)


def test_rejects_empty_bytes():
    with pytest.raises(ImageProcessingError):
        enhance_image(b"")
