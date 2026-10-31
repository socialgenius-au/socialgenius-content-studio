# Export accuracy: audio and last-frame preservation, and speed accuracy

Branch `integration/m2-release` (from the stabilisation branch `3663354`). Touches only `backend/app/services/ffmpeg_svc.py` (protected, approved for these two corrections). No dependency, Dockerfile, Railway, migration, environment or frontend file, and the legacy `/process` export path is untouched.

## Exact changes (the whole production diff is about 30 lines)

**A. Audio and final-frame preservation**
* `composite_image_overlays` (shapes, pictures, text, lower thirds, subtitles) and `composite_video_inserts` (B-roll) never change the audio: they now `-c:a copy` it instead of re-encoding it. `composite_media_overlays` copies it too unless an overlay's own audio is being mixed in (then it still encodes).
* Those three passes end at the timeline's exact length with `-t <frames/30>` (passed from `render_project`, which knows it from the plan) instead of `-shortest`. Reason, found while verifying this change: with *copied* audio, `-shortest` closed the file on the audio stream's end and cut 2 to 4 video frames when layers ran past the end of the timeline. `-shortest` remains when no length is passed.
* Passes that change the audio still encode it: the segment build, the clip join (`acrossfade` / `concat`), the gap join, the A1 mix, and overlay-audio mixing.

**B. Speed accuracy**
* `setpts=PTS/{speed}` is followed by `fps=30` in the same filter chain, and a speed-changed segment is capped to its exact length (`-t source_duration / speed`). Speed 1 clips take exactly the path they always did (no `setpts`, no cap).

## Measured results (real ffmpeg, barcoded synthetic clips decoded frame by frame)

| Case | Before | After |
|---|---|---|
| 12 s two-clip export + shape + picture + B-roll insert + lower third + subtitle + A1 voice-over | 358 frames (11.933 s), audio 11.912 s | **360 frames (12.000 s), audio 12.005 s** at every step |
| 7 s gap project, same layers | 208 frames | **210 frames** at every step |
| Layers running past the end of the timeline (7 s timeline, layers to 9 s), with the audio copy but still `-shortest` | 205 to 209 frames | **210 frames** at every step (with `-t`) |
| Speed 2×, 3 s timeline | 91 frames, one output frame (33 ms) late: source frames 60, 61, 62, 64… against 60, 62, 64… | **90 frames, every frame exact** |
| Speed 1.5× | 91 frames, median −1 source frame | **90 frames, median 0**, rounding ≤ 1 source frame |
| Speed 0.75× | 90 frames, median 0 | **90 frames**, median 0, ≤ 1 (an intermediate version of this change, with `fps=30` but without the length cap, gave 91, which is why the cap exists) |
| Speed 0.5× | 89 frames | **90 frames**, median 0, ≤ 1 |
| Speed 1× | exact | exact (unchanged path) |
| Mixed-speed timeline (2×, 1×, 0.5× hard-cut together) | not measured | **180 frames; every clip's frames at median 0, ≤ 1** |

## Tests

`backend/tests/test_export_accuracy.py` (13): which passes copy the audio and which encode it (by recording the real ffmpeg commands); overlay audio still mixed and encoded; a layered 12 s export has exactly 360 frames and a 12.000 s audio length; audio is continuous (no dropout inside either clip or the voice-over) and clip B's audio starts at 6.0 s with no bleed; an explicit gap with all layers keeps 210 frames and B's audio at 4.0 s; layers that outlast the timeline do not shorten it (contiguous and gapped); decoded frames equal the intended source frames at 0.5×, 1×, 1.5× and 2× (exact at 1× and 2×, ≤ 1 elsewhere, always the exact frame count); a mixed-speed timeline; the speed-changed clip's audio stays on its own span; the filter chain gets `setpts…,fps=30` only for speed ≠ 1.

## Known limitations

* The container's audio stream is about one AAC frame (a few ms) longer than the video (12.005 s against 12.000 s), because the audio is copied unchanged; playback is bounded by the video.
* For non-integer speed ratios (0.5×, 0.75×, 1.5×) a decoded frame can differ from the ideal by one *source* frame: the rounding inherent to showing a 30 fps source at those ratios.
* Each overlay pass still re-encodes the video (generation loss is unchanged); only the audio is no longer re-encoded needlessly.
* The old `/process` export path keeps its own passes and `-shortest`.

## Rollback

Revert the commit. Nothing else depends on it.
