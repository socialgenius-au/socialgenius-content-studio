"""Deterministic cross-business scene adaptation. No AI calls or database writes."""
from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class SceneBeat:
    index: int
    start_seconds: float
    end_seconds: float
    purpose: str
    mechanism: str


def scene_structure(scenes: Sequence[Mapping]) -> tuple[SceneBeat, ...]:
    """Validate ordered, non-overlapping scene beats without inventing visual evidence."""
    result = []
    for i, raw in enumerate(scenes):
        start, end = float(raw.get("start_seconds", 0)), float(raw.get("end_seconds", 0))
        if start < 0 or end <= start:
            raise ValueError(f"Scene {i + 1} has invalid timing")
        if result and start < result[-1].end_seconds - 0.001:
            raise ValueError(f"Scene {i + 1} overlaps previous scene")
        result.append(SceneBeat(i + 1, start, end, str(raw.get("purpose") or ""), str(raw.get("mechanism") or "")))
    if not result:
        raise ValueError("At least one source scene is required")
    return tuple(result)


def relevant_lessons(lessons: Sequence[Mapping]) -> tuple[str, ...]:
    """Accepted is a preference, not evidence of better performance."""
    return tuple(dict.fromkeys(
        str(x.get("recommendation", "")).strip()
        for x in lessons
        if x.get("status") == "accepted" and x.get("relevant_to_target") is True
        and str(x.get("recommendation", "")).strip()
    ))


def creative_context(*, task: str, source_business: str, target_business: str,
                     topic: str, audience: str, objective: str,
                     scenes: Sequence[Mapping], lessons: Sequence[Mapping] = ()) -> str:
    """Build grounded context for future Hook/Script integrations, without paid AI."""
    if task not in {"hook", "script"}:
        raise ValueError("Unsupported creative task")
    if not target_business.strip():
        raise ValueError("Target business is required")
    beats = scene_structure(scenes)
    scene_lines = "\n".join(
        f"Scene {s.index}: {s.start_seconds:g}-{s.end_seconds:g}s; purpose={s.purpose}; mechanism={s.mechanism}"
        for s in beats
    )
    kept = "\n".join("- " + x for x in relevant_lessons(lessons)) or "None"
    return (
        f"Task: {task}\nTarget business: {target_business}\nTopic: {topic}\n"
        f"Audience: {audience}\nObjective: {objective}\n"
        f"Source business (structure ONLY): {source_business}\n"
        f"Scene structure:\n{scene_lines}\n"
        f"Relevant accepted lessons (preferences, NOT measured outcomes):\n{kept}\n"
        "Preserve structural mechanisms and timing, but create original target-business "
        "visuals, wording, examples and call to action. Never copy source-specific claims, "
        "products, evidence or sensory cues. Do not invent statistics, testimonials or "
        "performance. Flag missing facts rather than guessing."
    )
