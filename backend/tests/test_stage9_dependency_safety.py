"""Video Deconstructor — Stage 9 Phase A: dependency-safety tests. Confirms promoting OpenCV
from a silent transitive guest of easyocr to an explicit, direct, pinned dependency did not break
anything already relying on it, and that the exact capabilities Stage 9 Phase A needs are present."""
import cv2


def test_cv2_imports_and_exposes_required_functions():
    assert hasattr(cv2, "phaseCorrelate")
    assert hasattr(cv2, "ORB_create")
    assert hasattr(cv2, "estimateAffinePartial2D")
    assert hasattr(cv2, "BFMatcher")


def test_easyocr_still_imports():
    import easyocr  # noqa: F401 -- import success is the test


def test_torchvision_still_imports():
    import torchvision  # noqa: F401 -- import success is the test
    assert torchvision.__version__.startswith("0.28")
