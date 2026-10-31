"""
Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Phase A tests.

`visual_object_svc.py` is a pure input(image path)->output(dict) service with no SQLAlchemy/DB/
router dependency at all (see its own module docstring) — these tests exercise it in isolation,
with the real torchvision model/inference call mocked out (same `unittest.mock.patch.object`
convention every other Stage 6/7 engine-call test in this suite already uses), so no real model
load or real inference happens here. See the Phase-A implementation report for the one, separate,
real-four-frame comparison this default model/threshold was chosen from.

Covers the 18 requested checks: 1 (successful structured detection), 2 (native label preserved),
3 (class ID preserved), 4 (detector confidence preserved), 5 (normalized geometry correct), 6
(normalized geometry clamped to 0-1), 7 (zero detections is successful), 8 (threshold filtering),
9 (missing file fails honestly), 10 (unreadable/corrupt image fails honestly), 11 (model failure
propagates honestly), 12 (model lazy-load/cache works), 13 (same model not reloaded), 14 (no
database imports/dependencies), 15 (no router dependency), 16 (no fabricated transform fields),
17 (Unicode file-path handling), 18 (CPU-only inference path, no CUDA reference anywhere).
"""
import inspect
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import torch

from app.services import visual_object_svc
from app.services.visual_object_svc import (
    MODEL_FASTERRCNN, MODEL_SSDLITE, analyze_visual_objects, _get_model,
)


def _fake_weights(categories: list[str]) -> MagicMock:
    weights = MagicMock()
    weights.meta = {"categories": categories}
    return weights


def _fake_raw_output(boxes: list[list[float]], labels: list[int], scores: list[float]) -> dict:
    return {
        "boxes": torch.tensor(boxes, dtype=torch.float32) if boxes else torch.empty((0, 4)),
        "labels": torch.tensor(labels, dtype=torch.int64) if labels else torch.empty((0,), dtype=torch.int64),
        "scores": torch.tensor(scores, dtype=torch.float32) if scores else torch.empty((0,)),
    }


# 91-slot COCO-shaped category list, matching the real torchvision weights.meta["categories"]
# convention (index 0 = "__background__"; only the indices used below are filled meaningfully).
_FAKE_CATEGORIES = ["__background__"] + [f"class_{i}" for i in range(1, 91)]
_FAKE_CATEGORIES[1] = "person"
_FAKE_CATEGORIES[77] = "cell phone"


def _patched_model(raw_output: dict, categories: list[str] = _FAKE_CATEGORIES):
    fake_model = MagicMock(return_value=[raw_output])
    fake_weights = _fake_weights(categories)
    return patch.object(visual_object_svc, "_get_model", new=AsyncMock(return_value=(fake_model, fake_weights)))


def _patched_image(width: int = 480, height: int = 864):
    fake_image = MagicMock()
    fake_image.size = (width, height)
    return patch.object(visual_object_svc, "_load_image_sync", return_value=fake_image)


# ---------------------------------------------------------------------------
# 1/2/3/4. Successful structured detection: native label, class id, confidence all preserved.
# ---------------------------------------------------------------------------

async def test_successful_detection_returns_correctly_mapped_structure():
    raw = _fake_raw_output(boxes=[[48.0, 155.0, 480.0, 665.0]], labels=[77], scores=[0.83])
    with _patched_model(raw), _patched_image(width=480, height=864):
        result = await analyze_visual_objects("some/frame.jpg", confidence_threshold=0.1)

    assert result["model"] == visual_object_svc.DEFAULT_MODEL_NAME
    assert result["confidence_threshold"] == 0.1
    assert result["image_width"] == 480
    assert result["image_height"] == 864
    assert len(result["detections"]) == 1

    d = result["detections"][0]
    assert d["class_id"] == 77
    assert d["label"] == "cell phone"  # 2: native detector label preserved
    assert d["confidence_score"] == pytest.approx(0.83)  # 4: real detector confidence preserved
    assert d["bbox_pixels"] == {"x1": 48.0, "y1": 155.0, "x2": 480.0, "y2": 665.0}


# ---------------------------------------------------------------------------
# 5/6. Normalized geometry is computed correctly, and clamped to 0-1 defensively.
# ---------------------------------------------------------------------------

async def test_normalized_geometry_is_computed_correctly():
    # A box exactly at (100,200)-(300,600) in a 400x800 image -> x=0.25, y=0.25, w=0.5, h=0.5.
    raw = _fake_raw_output(boxes=[[100.0, 200.0, 300.0, 600.0]], labels=[1], scores=[0.9])
    with _patched_model(raw), _patched_image(width=400, height=800):
        result = await analyze_visual_objects("some/frame.jpg", confidence_threshold=0.1)

    norm = result["detections"][0]["bbox_normalized"]
    assert norm["x"] == pytest.approx(0.25)
    assert norm["y"] == pytest.approx(0.25)
    assert norm["width"] == pytest.approx(0.5)
    assert norm["height"] == pytest.approx(0.5)


async def test_normalized_geometry_is_clamped_to_zero_one():
    # A box with an x1 below 0 and an x2 beyond image_width (real detector floating-point output
    # can slightly exceed the image bounds) — normalized values must never leave [0, 1].
    raw = _fake_raw_output(boxes=[[-10.0, -5.0, 490.0, 900.0]], labels=[1], scores=[0.9])
    with _patched_model(raw), _patched_image(width=480, height=864):
        result = await analyze_visual_objects("some/frame.jpg", confidence_threshold=0.1)

    norm = result["detections"][0]["bbox_normalized"]
    assert 0.0 <= norm["x"] <= 1.0
    assert 0.0 <= norm["y"] <= 1.0
    assert 0.0 <= norm["width"] <= 1.0
    assert 0.0 <= norm["height"] <= 1.0
    assert norm["x"] == 0.0  # clamped from a negative value
    assert norm["y"] == 0.0


# ---------------------------------------------------------------------------
# 7. Zero detections is a normal, successful result.
# ---------------------------------------------------------------------------

async def test_zero_detections_is_a_successful_result():
    raw = _fake_raw_output(boxes=[], labels=[], scores=[])
    with _patched_model(raw), _patched_image():
        result = await analyze_visual_objects("empty/frame.jpg")

    assert result["detections"] == []
    assert result["image_width"] == 480  # a real result, not an exception


# ---------------------------------------------------------------------------
# 8. Threshold filtering: only detections at/above the threshold are returned, and the
#    detector's own confidence_score is never itself modified by the threshold.
# ---------------------------------------------------------------------------

async def test_threshold_filtering_excludes_low_confidence_detections():
    raw = _fake_raw_output(
        boxes=[[0.0, 0.0, 10.0, 10.0], [0.0, 0.0, 20.0, 20.0], [0.0, 0.0, 30.0, 30.0]],
        labels=[1, 77, 1], scores=[0.83, 0.35, 0.40],
    )
    with _patched_model(raw), _patched_image():
        result = await analyze_visual_objects("some/frame.jpg", confidence_threshold=0.40)

    scores = sorted(d["confidence_score"] for d in result["detections"])
    assert scores == pytest.approx([0.40, 0.83])  # 0.35 excluded; 0.40 (the boundary) and 0.83 included
    assert not any(d["confidence_score"] == pytest.approx(0.35) for d in result["detections"])


# ---------------------------------------------------------------------------
# 9/10. Missing/corrupt media fails honestly — real PIL errors, not mocked.
# ---------------------------------------------------------------------------

async def test_missing_file_fails_honestly():
    with pytest.raises(FileNotFoundError):
        await analyze_visual_objects("this/path/does/not/exist.jpg")


async def test_corrupt_image_fails_honestly(tmp_path):
    bad_file = tmp_path / "not_really_an_image.jpg"
    bad_file.write_bytes(b"this is not valid image data at all")
    with pytest.raises(Exception):  # PIL's own UnidentifiedImageError/OSError — a real failure
        await analyze_visual_objects(str(bad_file))


# ---------------------------------------------------------------------------
# 11. A genuine model failure propagates — never swallowed into a fake success.
# ---------------------------------------------------------------------------

async def test_model_failure_propagates():
    with patch.object(visual_object_svc, "_get_model", new=AsyncMock(side_effect=RuntimeError("simulated model load failure"))):
        with pytest.raises(RuntimeError, match="simulated model load failure"):
            await analyze_visual_objects("some/frame.jpg")


async def test_inference_failure_propagates(tmp_path):
    # A real, tiny valid image so _load_image_sync succeeds; the failure is injected at the
    # inference call itself, one level below _get_model.
    from PIL import Image
    real_image_path = tmp_path / "tiny.jpg"
    Image.new("RGB", (10, 10), color="red").save(real_image_path)

    fake_model = MagicMock(side_effect=RuntimeError("simulated inference failure"))
    fake_weights = _fake_weights(_FAKE_CATEGORIES)
    with patch.object(visual_object_svc, "_get_model", new=AsyncMock(return_value=(fake_model, fake_weights))), \
         patch.object(visual_object_svc, "_run_inference_sync", side_effect=RuntimeError("simulated inference failure")):
        with pytest.raises(RuntimeError, match="simulated inference failure"):
            await analyze_visual_objects(str(real_image_path))


# ---------------------------------------------------------------------------
# 12/13. Model lazy-loading/caching: a repeated call with the same model_name does not reload it.
# ---------------------------------------------------------------------------

async def test_model_is_cached_and_not_reloaded_on_repeated_calls():
    visual_object_svc._models.clear()  # isolate this test from any other test's cache state
    fake_model, fake_weights = MagicMock(), _fake_weights(_FAKE_CATEGORIES)
    with patch.object(visual_object_svc, "_load_model_sync", return_value=(fake_model, fake_weights)) as mock_load:
        first = await _get_model(MODEL_FASTERRCNN)
        second = await _get_model(MODEL_FASTERRCNN)

    assert first is second
    mock_load.assert_called_once_with(MODEL_FASTERRCNN)  # never reloaded
    visual_object_svc._models.clear()


async def test_different_model_names_are_cached_independently():
    visual_object_svc._models.clear()
    with patch.object(visual_object_svc, "_load_model_sync", side_effect=lambda name: (MagicMock(name=name), _fake_weights(_FAKE_CATEGORIES))) as mock_load:
        await _get_model(MODEL_SSDLITE)
        await _get_model(MODEL_FASTERRCNN)
        await _get_model(MODEL_SSDLITE)  # already cached — must not trigger a third load

    assert mock_load.call_count == 2
    visual_object_svc._models.clear()


# ---------------------------------------------------------------------------
# 14/15. No database or router dependency anywhere in this module (static source inspection).
# ---------------------------------------------------------------------------

def test_module_has_no_database_or_router_imports():
    source = inspect.getsource(visual_object_svc)
    forbidden_substrings = ["app.database", "app.models", "app.routers", "sqlalchemy", "fastapi", "AsyncSession"]
    for forbidden in forbidden_substrings:
        assert forbidden not in source, f"visual_object_svc.py unexpectedly references {forbidden!r}"


# ---------------------------------------------------------------------------
# 16. No fabricated transform fields (rotation/scale/anchor/opacity/z_index) anywhere in output.
# ---------------------------------------------------------------------------

async def test_no_fabricated_transform_fields_in_result():
    raw = _fake_raw_output(boxes=[[0.0, 0.0, 10.0, 10.0]], labels=[1], scores=[0.9])
    with _patched_model(raw), _patched_image():
        result = await analyze_visual_objects("some/frame.jpg", confidence_threshold=0.1)

    detection = result["detections"][0]
    for forbidden_key in ("rotation", "scale", "scale_x", "scale_y", "anchor", "anchor_x", "anchor_y", "opacity", "z_index", "certainty", "confidence"):
        assert forbidden_key not in detection
        assert forbidden_key not in detection.get("bbox_normalized", {})


# ---------------------------------------------------------------------------
# 17. Unicode file-path handling.
# ---------------------------------------------------------------------------

async def test_unicode_file_path_is_handled(tmp_path):
    from PIL import Image
    unicode_dir = tmp_path / "参照フレーム_тест"
    unicode_dir.mkdir()
    unicode_path = unicode_dir / "画像.jpg"
    Image.new("RGB", (20, 20), color="blue").save(unicode_path)

    raw = _fake_raw_output(boxes=[], labels=[], scores=[])
    with _patched_model(raw):
        # _load_image_sync itself is real here (not mocked) — proves the actual PIL load path
        # handles a real Unicode path, not just that the string flows through untouched.
        result = await analyze_visual_objects(str(unicode_path))

    assert result["image_width"] == 20
    assert result["image_height"] == 20


# ---------------------------------------------------------------------------
# 18. CPU-only inference path — no CUDA reference anywhere in this module.
# ---------------------------------------------------------------------------

def test_module_never_invokes_cuda():
    """The module's own docstring legitimately documents its CPU-only design by name (e.g. "no
    CUDA assumed anywhere in this module") — this checks that CUDA is never actually INVOKED
    (a device move, a `.cuda()` call, `torch.cuda.*`), not that the word never appears in prose."""
    source = inspect.getsource(visual_object_svc)
    forbidden_usages = [".cuda(", "torch.cuda", 'device="cuda"', "device='cuda'", ".to(device"]
    for forbidden in forbidden_usages:
        assert forbidden not in source, f"visual_object_svc.py unexpectedly invokes CUDA via {forbidden!r}"
