"""No-cost tests for actual image enhancement; never call an AI provider."""
from io import BytesIO

import pytest
from PIL import Image

from app.services.image_enhancement import ImageProcessingError, enhance_image, remove_flat_background, remove_complex_background


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


def test_flat_background_removed_but_centre_subject_preserved():
    image = Image.new("RGBA", (20, 20), (255, 255, 255, 255))
    for y in range(6, 14):
        for x in range(6, 14):
            image.putpixel((x, y), (20, 40, 100, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    with Image.open(BytesIO(remove_flat_background(buffer.getvalue()))) as result:
        assert result.getpixel((0, 0))[3] == 0
        assert result.getpixel((10, 10))[3] == 255


def test_flat_background_rejects_invalid_tolerance():
    with pytest.raises(ImageProcessingError):
        remove_flat_background(_image(), tolerance=200)


def test_complex_background_rejects_small_image():
    with pytest.raises(ImageProcessingError, match="40 pixels"):
        remove_complex_background(_image())


def test_complex_background_rejects_invalid_margin():
    with pytest.raises(ImageProcessingError, match="Margin"):
        remove_complex_background(_image(), margin_percent=30)


def test_complex_background_preserves_central_subject():
    image = Image.new("RGBA", (120, 120), (240, 240, 240, 255))
    for y in range(28, 92):
        for x in range(28, 92):
            image.putpixel((x, y), (20, 40, 100, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    with Image.open(BytesIO(remove_complex_background(buffer.getvalue()))) as result:
        assert result.size == (120, 120)
        assert result.getpixel((0, 0))[3] == 0
        assert result.getpixel((60, 60))[3] == 255
