"""Classify timestamped windows of the reference mix with MediaPipe YAMNet."""
import asyncio
import os

from app.services.ffmpeg_svc import FFMPEG_BIN

RATE = 16000
MAX_SECONDS = 180
WINDOW_SECONDS = 0.975
SPEECH = {"Speech", "Narration, monologue", "Conversation", "Female speech, woman speaking",
          "Male speech, man speaking", "Child speech, kid speaking"}
MUSIC = {"Music", "Background music", "Musical instrument", "Singing", "Guitar", "Piano",
         "Drum", "Electronic music", "Classical music", "Pop music"}
AMBIENT = {"Rain", "Raindrop", "Water", "Stream", "Waves, surf", "Wind", "Thunder",
           "Bird", "Bird vocalization, bird call, bird song", "Traffic noise, roadway noise"}
EFFECTS = {"Sound effect", "Whoosh, swoosh, swish", "Clicking", "Explosion", "Clapping",
           "Knock", "Bang", "Thump, thud", "Glass", "Shatter"}


def collect_events(windows, duration):
    events = []
    latest = {}
    for start, categories in windows:
        end = min(duration, start + WINDOW_SECONDS)
        if end <= start:
            continue
        for kind, labels in (("speech", SPEECH), ("music", MUSIC), ("ambience", AMBIENT), ("effect", EFFECTS)):
            score, label = max(((score, label) for label, score in categories if label in labels),
                               default=(0, ""))
            if score < 0.40:
                continue
            previous = latest.get((kind, label))
            if previous and start <= previous["end"] + 0.025:
                previous["end"] = end
                previous["windows"] += 1
                previous["score"] = round(max(previous["score"], score), 3)
            else:
                previous = {"kind": kind, "label": label, "start": start, "end": end,
                            "score": round(score, 3), "windows": 1}
                latest[kind, label] = previous
                events.append(previous)
    for event in events:
        event["confidence"] = "high" if event["score"] >= 0.75 and event["windows"] >= 2 else "medium" if event["score"] >= 0.55 else "low"
        event["evidence"] = "YAMNet classification of the decoded source mix; score is a model output."
    return events


def classify_pcm(pcm):
    import mediapipe as mp
    import numpy as np

    samples = np.frombuffer(pcm, dtype="<f4")
    if not len(samples):
        return []
    options = mp.tasks.audio.AudioClassifierOptions(
        base_options=mp.tasks.BaseOptions(
            model_asset_path=os.environ.get("TECHNICAL_AUDIO_MODEL", "/app/models/yamnet.tflite")),
        running_mode=mp.tasks.audio.RunningMode.AUDIO_CLIPS,
        max_results=32,
    )
    audio = mp.tasks.components.containers.AudioData.create_from_array(samples.copy(), sample_rate=RATE)
    with mp.tasks.audio.AudioClassifier.create_from_options(options) as classifier:
        results = classifier.classify(audio)
    events = collect_events(
        ((window.timestamp_ms / 1000,
          [(category.category_name, category.score)
           for group in window.classifications for category in group.categories])
         for window in results if window.timestamp_ms is not None),
        len(samples) / RATE,
    )
    for event in events:
        if event["kind"] == "music":
            tempo = estimate_tempo(samples, event["start"], event["end"])
            if tempo is not None:
                event["tempo_bpm"] = tempo
    return events


def estimate_tempo(samples, start, end):
    """Estimate pulse from repeated energy onsets on music-positive portions."""
    import numpy as np

    hop = RATE // 50
    clip = samples[int(start * RATE):int(end * RATE)]
    if len(clip) < 6 * RATE:
        return None
    blocks = clip[:len(clip) // hop * hop].reshape(-1, hop)
    power = np.log1p(1000 * np.mean(blocks ** 2, axis=1))
    onset = np.maximum(0, np.diff(power))
    onset -= onset.mean()
    correlation = np.correlate(onset, onset, mode="full")[len(onset) - 1:]
    if correlation[0] <= 1e-7:
        return None
    minimum, maximum = 17, 50  # 60–176 BPM at 50 measurements per second.
    lag = int(np.argmax(correlation[minimum:maximum + 1])) + minimum
    if correlation[lag] / correlation[0] < 0.30:
        return None
    return round(3000 / lag)


async def analyze_audio(path, duration):
    proc = await asyncio.create_subprocess_exec(
        FFMPEG_BIN, "-nostdin", "-v", "error", "-i", path, "-map", "0:a:0", "-t", str(MAX_SECONDS),
        "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        pcm, _ = await proc.communicate()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    if proc.returncode or not pcm:
        raise ValueError("Reference audio could not be decoded")
    events = await asyncio.to_thread(classify_pcm, pcm)
    limits = ["Audio classifications are approximate. The mixed track cannot establish separate layers or editorial intent."]
    if duration > MAX_SECONDS:
        limits.append(f"Only the first {MAX_SECONDS} seconds of audio were classified.")
    return events, limits
