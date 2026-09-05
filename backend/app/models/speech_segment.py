"""Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase A: evidence-storage
foundation ONLY. No transcription runs yet, no endpoint exists yet — this file only makes the
schema capable of storing what a future speech-analysis pass will write.

Named `SpeechSegment`, deliberately NOT `Transcript` — this project already has a `Transcript`
model (backend/app/models/transcript.py) backing the existing, unrelated, actively-used editor
feature ("Generate Captions from Audio" in Video Studio V2's Create/Edit tab): it hangs off
`Asset`/`Job`, carries no certainty/confidence/evidence fields, and is not touched by this file in
any way. `SpeechSegment` is the Deconstructor-side counterpart to `TextElement` (Stage 6's OCR
evidence table) — same evidence philosophy, same certainty vocabulary, same
video_analysis_id-scoped relationship, but for HEARD words instead of SEEN text. The two concepts
(on-screen OCR text vs. spoken/heard transcript) are deliberately kept in separate tables, exactly
as they already are conceptually in this codebase.

Evidence chain this table anchors (Phase A builds only the storage; later phases populate it):
    RAW SOURCE AUDIO -> ASR OBSERVATION -> this row (TIMED SPEECH SEGMENT)
    -> future logical/semantic analysis -> future reconstruction candidate

Confidence discipline (the one rule Phase A exists to enforce structurally): a speech-recognition
engine's own internal decoding diagnostics (e.g. Whisper's avg_logprob, no_speech_prob,
compression_ratio, temperature, model name/version) are NOT a calibrated 0-1 probability of
transcript correctness — inventing a percentage from them would be exactly the kind of fabricated
precision this project's certainty philosophy exists to prevent. `analysis_details` (open JSON,
same "small evolving payload, no schema needed for a new key" convention as
ReferenceVideo.technical_details / AnalysisAnnotation.details / TextElement.style_details) is
where those raw, uncalibrated diagnostics are preserved VERBATIM for audit. `confidence_score`
stays NULL unless a future pass has a genuinely defensible 0-1 confidence measurement for that
specific row — "confidence unavailable" is always preferred over a fabricated number.

`speaker_label` (nullable, open string, e.g. "Speaker 1") is added now, unused, for the same
"cheap now, expensive to retrofit onto a populated table later" reason Shot/TextElement/
VisualObject already added their own not-yet-populated columns (scale/rotation/anchor/z_index) —
no diarization runs in Phase A or any phase described here; this only avoids a future migration.

`shot_id` is nullable and independent of `video_analysis_id` (never required to reach one
transitively through the other) — mirrors Shot's and AnalysisAnnotation's own existing nullable
`shot_id` precedent: speech is continuous and does not necessarily align to visual cut boundaries,
so a segment may legitimately span across, before, or after any given Shot's own start/end.

No geometry columns (x/y/width/height/rotation/scale/anchor/opacity/z_index) — speech has no
on-screen position; adding TextElement's own geometry shape here would be exactly the kind of
generic abstraction imposed for its own sake that this stage's own design review rejected.

No FK to Asset/ReferenceVideo's underlying audio file — Phase A stores evidence rows only; which
extracted audio file produced them is future-phase scope, added additively then if genuinely
needed, following this same file's own "add a column when the stage that needs it arrives"
convention rather than speculatively now.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL


class SpeechSegment(Base):
    __tablename__ = "speech_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    # Nullable and independent — see this module's own docstring on why speech does not
    # necessarily align to a Shot's own visual cut boundaries.
    shot_id: Mapped[int | None] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), nullable=True)

    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)

    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable, no default — unlike the unrelated Transcript.language (which defaults to "en" for
    # its own, different, general-purpose editor use case), Stage 7 never assumes a language it
    # hasn't actually determined; NULL means "not established," never "assumed English."
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Forward-compatibility placeholder only — see this module's own docstring. No diarization
    # pass exists yet to populate this.
    speaker_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    # Deliberately nullable with no default — see this module's own docstring's "Confidence
    # discipline" section. A future writer leaves this NULL whenever no genuinely defensible 0-1
    # confidence measurement exists for a row, rather than fabricating one from raw ASR
    # diagnostics (which belong in analysis_details instead, verbatim, uncalibrated).
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Raw, uncalibrated engine decoding diagnostics — see this module's own docstring. E.g. (once
    # a future pass writes them): {"engine": "whisper", "model": "base", "avg_logprob": -0.31,
    # "no_speech_prob": 0.02, "compression_ratio": 1.4, "temperature": 0.0}. Never read as a
    # confidence percentage by anything — audit/debugging context only.
    analysis_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_speech_segments_time_order"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_speech_segments_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_speech_segments_confidence_range"),
        Index("ix_speech_segments_video_analysis_id", "video_analysis_id"),
        Index("ix_speech_segments_shot_id", "shot_id"),
    )
