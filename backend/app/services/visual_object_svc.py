"""Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Phase A: an
independent, local, CPU-oriented visual-object detection service. Pure input (an image file
path) -> output (a plain dict) function — no SQLAlchemy, no VideoAnalysis/ReferenceVideo
awareness, no database access, no router, no frontend dependency of any kind. A peer of
`ocr_svc.py`/`speech_analysis_svc.py`/`audio_structure_svc.py` (this project's own established
"pure engine call, no DB knowledge" service pattern for each Deconstructor stage), not a caller
of any of them and not called by any of them.

Uses torchvision's own pretrained COCO object-detection model zoo — already installed (torch and
torchvision are both existing dependencies of Stage 6's OCR pipeline; see requirements.txt) — so
this needs zero new pip package, only a one-time official torchvision model-weight download on
first real use, the exact same "local, free, one-time download, then fully offline" pattern this
project already established twice (EasyOCR's own recognition weights, Whisper's own ASR weights).

Evidence semantics (the reason this file exists, and the most important thing to get right):
a detector's own class label is DIRECTLY RETURNED EVIDENCE, never an unquestionable measured
fact about the real world. `label="person", confidence_score=0.87` means exactly "the detector
classified this pixel region as its own 'person' class with this score" — it does NOT mean "a
real physical person appears in this scene." This distinction is not academic: this project's own
real reference video contains people displayed INSIDE a phone's own screen (a video-within-video),
which a generic detector cannot and does not distinguish from a directly-filmed person. Phase A
therefore returns ONLY the detector's own raw output (bounding box, class id, native COCO label,
confidence score) — it never labels a detection as "foreground", "dominant subject",
"physical vs. on-screen", or any other interpretation. That reasoning belongs to a later,
explicitly INFERRED stage, exactly mirroring the MEASURED/INFERRED split Stage 6 already
established between raw OCR observations and Recurring Element linkage.

Class-label discipline: this module returns the detector's OWN native COCO label (e.g. "cell
phone", "keyboard", "person") verbatim — it never maps these into this project's own Deconstructor
categories (person/product/logo/background/prop). That mapping is explicitly Phase B's job (a
persistence/integration-time decision), not this service's — keeping raw detector evidence intact
here means a later remapping decision never requires re-running detection.

Transform discipline: this module returns ONLY what a bounding-box detector can actually measure
(class, confidence, normalized geometry). It never fabricates rotation, scale, anchor, opacity, or
z_index — the future `VisualObject` model has columns for these, but a 2D bounding-box detector
has no way to measure any of them, and inventing default values here would misrepresent what was
actually observed.

Explicit prohibition (Stage 8's own hard boundary, not merely a Phase-A choice): this module never
infers or returns identity, face recognition, age, gender, ethnicity, race, emotion,
attractiveness, disability, religion, or political affiliation for any detected "person" region —
"person" is only ever a generic structural detector class, nothing more, and the underlying COCO
object-detection models used here have no capability to produce any such attribute in the first
place (they were never trained for it).
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Separate from every other Stage 6/7 service's own executor/singleton — see this module's own
# docstring for why functional isolation (not accidental duplication) is this project's own
# established convention for each Deconstructor stage's pure engine-call service.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="visual_object")
_models: dict[str, tuple] = {}  # keyed by model_name -> (model, weights), see _get_model
_models_lock = asyncio.Lock()

# The two realistic lightweight torchvision candidates evaluated for this stage (see the Phase-A
# implementation report for the real four-frame comparison this default was chosen from) — both
# already available through the already-installed torchvision dependency, zero new package.
MODEL_SSDLITE = "ssdlite320_mobilenet_v3_large"
MODEL_FASTERRCNN = "fasterrcnn_mobilenet_v3_large_320_fpn"

# Chosen AFTER, not before, running both candidates against the four real Stage-5 frames
# available at implementation time (see the Phase-A implementation report for the full
# comparison table) — not chosen from theory or for being the faster/smaller option.
# fasterrcnn_mobilenet_v3_large_320_fpn detected "person" at 0.46-0.83 confidence and
# "keyboard" at 0.82-0.95 across those frames; ssdlite320_mobilenet_v3_large never returned a
# "keyboard" label at all and its own "person" detections never exceeded 0.21 (below any usable
# threshold) on the exact same frames — a materially better real result that justifies the
# larger download (~74MB vs ~13MB) and marginally slower inference (both still sub-half-second
# per frame on CPU).
DEFAULT_MODEL_NAME = MODEL_FASTERRCNN
# On the same real four-frame sample, fasterrcnn_mobilenet_v3_large_320_fpn's genuine detections
# clustered at >=0.44 confidence (laptop/keyboard/tv/person) while its own false positives
# (umbrella, a second faint "tv", weak "mouse"/"cell phone" duplicates) all sat at <=0.35 — a
# clean, real gap in this specific sample. 0.40 sits in that gap. This is a first, documented
# baseline evaluated against exactly four frames from one video, not a validated universal
# threshold — a candidate for recalibration once more real frames/videos are analyzed, the same
# "provisional, named, versioned" spirit Stage 6's own OCR thresholds were held to.
DEFAULT_CONFIDENCE_THRESHOLD = 0.40


def _get_model_constructor(model_name: str):
    """Returns (constructor_fn, weights_enum_default) for a supported model_name. Raises
    ValueError for an unsupported name — a genuine caller error, never silently substituted."""
    if model_name == MODEL_SSDLITE:
        from torchvision.models.detection import SSDLite320_MobileNet_V3_Large_Weights, ssdlite320_mobilenet_v3_large
        return ssdlite320_mobilenet_v3_large, SSDLite320_MobileNet_V3_Large_Weights.DEFAULT
    if model_name == MODEL_FASTERRCNN:
        from torchvision.models.detection import (
            FasterRCNN_MobileNet_V3_Large_320_FPN_Weights, fasterrcnn_mobilenet_v3_large_320_fpn,
        )
        return fasterrcnn_mobilenet_v3_large_320_fpn, FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT
    raise ValueError(f"Unsupported model_name: {model_name!r} (supported: {MODEL_SSDLITE!r}, {MODEL_FASTERRCNN!r})")


def _load_model_sync(model_name: str):
    """Blocking model construction — always run via the executor, never on the event loop. CPU-
    only throughout (no CUDA assumed anywhere in this module); `model.eval()` + the caller's own
    `torch.no_grad()` at inference time (see `_run_inference_sync`) avoids retaining any
    autograd-graph state across calls."""
    constructor, weights = _get_model_constructor(model_name)
    model = constructor(weights=weights)
    model.eval()
    return model, weights


async def _get_model(model_name: str):
    """Lazy-loaded, cached per model_name — a repeated call with the same model_name never
    reloads it; a different model_name loads and caches that one separately (same convention as
    speech_analysis_svc._get_model)."""
    if model_name not in _models:
        async with _models_lock:
            if model_name not in _models:
                loop = asyncio.get_event_loop()
                _models[model_name] = await loop.run_in_executor(_executor, _load_model_sync, model_name)
    return _models[model_name]


def _load_image_sync(image_path: str):
    """Blocking image load — always run via the executor. A genuinely missing/unreadable/corrupt
    file raises the real underlying exception (FileNotFoundError / PIL's own UnidentifiedImageError
    or OSError) — never caught here, never converted into a fake empty result."""
    from PIL import Image
    img = Image.open(image_path)
    img.load()  # force a real decode now, inside the executor thread — Image.open() alone is lazy
    # and can defer a genuine "corrupt file" error until first pixel access, which must not leak
    # out of the executor thread uncaught later.
    return img.convert("RGB")


def _run_inference_sync(model, weights, pil_image) -> dict:
    """Blocking inference — always run via the executor. `torch.no_grad()` avoids building an
    autograd graph (never needed for inference-only use); no tensor is retained beyond this
    function's own return value, so nothing accumulates across repeated calls."""
    import torch
    tensor = weights.transforms()(pil_image)
    with torch.no_grad():
        outputs = model([tensor])
    return outputs[0]  # one image in, one result dict out — {"boxes", "labels", "scores"}


async def analyze_visual_objects(
    image_path: str,
    *,
    model_name: str = DEFAULT_MODEL_NAME,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> dict:
    """Runs a local torchvision COCO object-detection model against one local image file (a
    Stage-5 representative frame, in the intended real use — this function has no idea where the
    image came from; that is entirely the caller's responsibility, not built in Phase A).

    Args:
        image_path: local image file path.
        model_name: which torchvision detector to use — MODEL_SSDLITE or MODEL_FASTERRCNN
            (default: DEFAULT_MODEL_NAME, see this module's own top-level constant and the
            Phase-A implementation report's real four-frame comparison for why).
        confidence_threshold: detections at or above this score are returned; anything below is
            silently omitted from `detections`, exactly mirroring a bounding-box detector's own
            standard usage — the detector's own `confidence_score` is always the real, unmodified
            value it reported, never itself altered by this threshold.

    Returns a dict:
        {
            "model": str,
            "confidence_threshold": float,
            "image_width": int,
            "image_height": int,
            "detections": [
                {
                    "class_id": int,               # the detector's own native COCO class index
                    "label": str,                  # the detector's own native COCO label, e.g. "cell phone"
                    "confidence_score": float,      # the detector's own real, unmodified score
                    "bbox_pixels": {"x1": float, "y1": float, "x2": float, "y2": float},
                    "bbox_normalized": {"x": float, "y": float, "width": float, "height": float},
                },
                ...
            ],  # empty list is a normal, valid, successful result when nothing meets the threshold
        }

    A genuine failure (a missing/unreadable/corrupt image file, or a real model-inference error)
    propagates as whatever exception PIL/torch itself raises — this function never catches and
    swallows an error, and never fabricates an empty-but-successful result in a failure's place.
    An image that decodes fine but yields zero above-threshold detections IS a successful result.
    """
    model, weights = await _get_model(model_name)
    loop = asyncio.get_event_loop()
    pil_image = await loop.run_in_executor(_executor, _load_image_sync, image_path)
    image_width, image_height = pil_image.size

    raw = await loop.run_in_executor(_executor, _run_inference_sync, model, weights, pil_image)
    categories = weights.meta["categories"]

    detections: list[dict] = []
    for box, label_idx, score in zip(raw["boxes"].tolist(), raw["labels"].tolist(), raw["scores"].tolist()):
        if score < confidence_threshold:
            continue
        x1, y1, x2, y2 = box
        detections.append({
            "class_id": int(label_idx),
            "label": categories[label_idx] if 0 <= label_idx < len(categories) else f"unknown_class_{label_idx}",
            "confidence_score": float(score),
            "bbox_pixels": {"x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2)},
            "bbox_normalized": {
                "x": max(0.0, min(1.0, x1 / image_width)),
                "y": max(0.0, min(1.0, y1 / image_height)),
                "width": max(0.0, min(1.0, (x2 - x1) / image_width)),
                "height": max(0.0, min(1.0, (y2 - y1) / image_height)),
            },
        })

    return {
        "model": model_name,
        "confidence_threshold": confidence_threshold,
        "image_width": image_width,
        "image_height": image_height,
        "detections": detections,
    }
