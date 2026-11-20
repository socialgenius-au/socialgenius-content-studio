"""Reusable guidance for each creative-mechanism TYPE: what the mechanism is for, when its principle may or may not apply to a different video, and how to adapt it (not copy it).

This is a documented RULE TABLE, not AI output and not a measurement: it states general conditions of use for a kind of mechanism, always labelled `source: taxonomy rule`. The evidence-aware additions
(`evidence_notes`) are derived deterministically from the channels the mechanism was actually observed in. Nothing here says a mechanism improves audience results; every purpose is worded as apparent design.
Nothing here contains words from any reference video, so it is safe to hand to the blueprint planner.
"""
from __future__ import annotations

SOURCE_LABEL = "taxonomy rule (general guidance for this kind of mechanism; not AI, not measured on any audience)"

_G = {
    "hook_curiosity": (
        "Appears designed to make the opening raise a question or hold something back, so the viewer has a reason to keep watching.",
        ["The new subject has something that can be shown or stated in the opening without giving the answer away.", "The objective is awareness or interest rather than an immediate transaction."],
        ["The brief requires the opening to carry a fixed statement (legal, safety, price or offer).", "There is nothing to reveal later in the video."],
        ["Choose the new subject's own unresolved element; do not reuse the reference's object, setting or people.", "Keep the opening short enough to take in within its first seconds."]),
    "problem_tension": (
        "Appears designed to surface a problem the audience recognises before anything is offered.",
        ["The audience has a real, nameable problem connected to the new offering."],
        ["The brief forbids negative framing.", "The problem could only be stated by making a claim the brief cannot support."],
        ["State the audience's problem in the brief's own terms; never import the reference's problem or story."]),
    "information_reveal": (
        "Appears designed to release information in a deliberate order so each step adds something new.",
        ["The new content has several facts or steps whose order matters."],
        ["The new content is a single message with nothing to sequence."],
        ["Order the new subject's own facts; keep what each step adds distinct."]),
    "progression": (
        "Appears designed to move through ordered stages so the video builds toward an end point.",
        ["The new subject has a natural sequence (steps, stages, before to after)."],
        ["The brief asks for a single static message."],
        ["Define the stages from the new subject; do not copy the reference's sequence of scenes."]),
    "contrast": (
        "Appears designed to place two states, options or outcomes side by side so a difference becomes visible.",
        ["The new subject offers a choice, a before/after, or a meaningful comparison that can be shown fairly."],
        ["The comparison would require a claim the brief prohibits (price, superiority, guarantees).", "There is no honest second state to compare."],
        ["Hold everything constant except the one thing being compared.", "Use the new subject's own options, never the reference's."]),
    "proof_credibility": (
        "Appears designed to make a claim believable by showing evidence for it.",
        ["Genuine proof exists for the new subject (a real result, a real process, a real credential)."],
        ["No genuine proof is available: do not invent testimonials, figures or results."],
        ["Use only proof the business can substantiate; label anything still to be supplied."]),
    "demonstration": (
        "Appears designed to show the subject being used, or its result, rather than describing it.",
        ["The new offering has an action or result that can be shown on screen."],
        ["The offering is intangible and nothing about it can be shown.", "The subject cannot be filmed or screen-recorded."],
        ["Show the new subject's own use or result; do not reproduce the reference's objects, props or setting."]),
    "pattern_interruption": (
        "Appears designed to break an expected pattern (a cut, a change of framing or a surprise) to re-engage attention.",
        ["The video is long enough for a pattern to be established and then broken."],
        ["The video is so short that no pattern exists to interrupt.", "The tone of the brief is calm and continuous by requirement."],
        ["Create the interruption from the new content's own rhythm."]),
    "pacing_rhythm": (
        "Appears designed to use the timing and rhythm of cuts to carry the viewer through the video.",
        ["The new content can be cut into similarly paced units."],
        ["The new footage is a single continuous take that should not be cut."],
        ["Match the rhythm's role, not its exact timings; fit durations to the new content."]),
    "emotional_progression": (
        "Appears designed to shift the emotional tone of the video from one state to another.",
        ["A person can appear on screen and the brand's tone allows a personal register."],
        ["No person can appear, or the brief requires a neutral or formal tone."],
        ["Derive the tone shift from the brief's own tone constraints; do not copy the reference's people or setting."]),
    "payoff_resolution": (
        "Appears designed to close what the video opened, so the viewer receives a resolution.",
        ["The new video raises a question, problem or promise that can be resolved within it."],
        ["Nothing is raised that needs resolving."],
        ["Resolve the new video's own opening; do not reuse the reference's resolution."]),
    "cta_next_step": (
        "Appears designed to point the viewer to a next step.",
        ["The brief supplies a call to action."],
        ["The brief supplies no call to action: none may be invented."],
        ["Describe the next step as an instruction and use only the call to action the brief supplies."]),
    "visual_attention": (
        "Appears designed to direct the eye to a particular subject through framing, focus or composition.",
        ["The new subject has a clear focal element that can be framed."],
        ["The new footage has no controllable composition (for example, a fixed screen recording)."],
        ["Apply the framing idea to the new subject's own focal element."]),
    "audio_attention": (
        "Appears designed to use sound or silence to hold or direct attention.",
        ["The new video will have designed sound or voice."],
        ["The new video is intended to be viewed muted or has no audio plan."],
        ["Use the new content's own audio; do not reuse the reference's voice or music."]),
    "text_attention": (
        "Appears designed to use on-screen text to carry or reinforce the message.",
        ["The new video uses on-screen text and the brief does not prohibit it."],
        ["The brief rules out on-screen text.", "The text would need to be too long to read in its time on screen."],
        ["Write new text for the new message; check it can be read within its time on screen."]),
    "other": (
        "A mechanism that does not fit the named types; see its own statement and limitations.",
        ["Apply only if its transferable principle clearly suits the new brief."],
        ["Its principle depends on something the new brief does not have."],
        ["Treat as a suggestion and check it against the brief before using."]),
}

_CHANNELS = {"audio": ("speech_segments", "silence_intervals"), "text": ("text_elements",), "visual": ("shots", "visual_objects", "creative_findings", "scenes", "story_beats"),
             "editing": ("transition_evidence", "pacing_phases")}


def evidence_channels(evidence_ids: dict | None) -> dict[str, int]:
    """How many pieces of evidence the mechanism cites in each channel (visual, audio, text, editing)."""
    ids = evidence_ids or {}
    return {ch: sum(len(ids.get(k) or []) for k in keys) for ch, keys in _CHANNELS.items()}


def position_label(start: float | None, end: float | None, duration: float | None) -> str | None:
    if start is None or end is None or not duration:
        return None
    mid = (start + end) / 2 / duration
    return "opening" if mid < 0.25 else ("closing" if mid > 0.75 else "middle")


def guidance_for(mechanism_type: str, *, channels: dict[str, int] | None = None, unreliable: set[str] | None = None, position: str | None = None) -> dict:
    purpose, applies, avoid, adapt = _G.get(mechanism_type) or _G["other"]
    notes: list[str] = []
    ch = channels or {}
    if ch.get("visual") and not ch.get("audio") and not ch.get("text"):
        notes.append("Observed in the visuals only, so it can be adapted without a voice-over or on-screen words.")
    if ch.get("audio") and "audio" in (unreliable or set()):
        notes.append("Part of the evidence is speech that was only machine-transcribed and is unverified: adapt the structural role, not what the speech appeared to say.")
    if ch.get("text") and "text" in (unreliable or set()):
        notes.append("Part of the evidence is on-screen text that may be a rendering artefact: do not rely on it.")
    if position:
        notes.append(f"In the reference it works in the {position} of the video; the blueprint may place it elsewhere if the brief requires.")
    return {"purpose": purpose, "applies_when": list(applies), "avoid_when": list(avoid), "adaptation_guidance": list(adapt), "evidence_notes": notes, "source": SOURCE_LABEL}
