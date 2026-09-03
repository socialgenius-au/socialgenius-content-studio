from app.models.user import User
from app.models.brand import Brand
from app.models.job import Job
from app.models.asset import Asset
from app.models.transcript import Transcript
from app.models.template import Template
from app.models.video_studio_draft import VideoStudioDraft

# Video Deconstructor — Stage 1 (Core Analysis Data Model). Entirely new, siloed schema; see
# reference_video.py's own module docstring for the full design rationale.
from app.models.reference_video import ReferenceVideo
from app.models.video_analysis import VideoAnalysis
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.text_element import TextElement
from app.models.visual_object import VisualObject
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.strategic_insight import StrategicInsight
# Stage 5 (Visual Evidence / Representative Frames) — additive; see shot_frame.py's own docstring.
from app.models.shot_frame import ShotFrame

__all__ = [
    "User", "Brand", "Job", "Asset", "Transcript", "Template", "VideoStudioDraft",
    "ReferenceVideo", "VideoAnalysis", "Scene", "Shot", "TextElement", "VisualObject",
    "AnalysisAnnotation", "StrategicInsight", "ShotFrame",
]
