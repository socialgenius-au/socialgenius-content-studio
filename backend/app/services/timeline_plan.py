"""Timeline plan for the V1 clip join: the single place that decides, in whole frames, where every clip sits on the editor's timeline and how a transition at a join is realised without moving anything.

CONTRACT (the editor's own): clip k occupies [start_k, end_k) on the timeline; clips are back to back; every other element (text, images, shapes, lower thirds, subtitles, V2 inserts, A1 audio) is
placed at absolute timeline seconds; the timeline is as long as the last clip's end. The editor never overlaps clips, so a transition must NOT change where any clip's footage sits.

The exporter used to realise a transition with ffmpeg `xfade`/`acrossfade` overlapping the two segments, which makes the output SHORTER by the transition's length per join (a hard cut counted as a 0.05 s overlap):
footage after a join then arrived earlier than the layers and audio laid at absolute times. Here a join is realised instead as:

  cut         -- the first frame of the next clip directly follows the last frame of the previous one (no overlap, no shift).
  fade_black  -- the outgoing clip fades to black over its own last frames, the incoming clip fades up over its own first frames (both inside the clips' own spans; nothing is borrowed).
  blend       -- (dissolve / wipe / zoom) a blend window [J - x, J + y] centred on the join J. The incoming clip is shown from J - x using REAL source frames from before its trim-in (its "pre-roll"), the outgoing
                 clip continues to J + y using REAL source frames after its trim-out (its "post-roll"). Both clips' main footage stays exactly where the editor puts it. Where the source file has no
                 spare frames on a side, the window is shortened to what exists (policy "shorten", the default: never invents or freezes a frame), or the missing frames are held. Policy
                 "hold_incoming" repeats only the INCOMING clip's first frame (the outgoing clip is never frozen); policy "hold" repeats the edge frame on both sides.

All positions are whole frames at FPS so footage, layers and audio cannot drift by accumulating rounding across joins: boundaries are rounded cumulatively from the clips' end times.
"""
from __future__ import annotations

from dataclasses import dataclass, field

FPS = 30
MIN_BLEND_FRAMES = 2  # shorter than this is a cut


def to_frames(seconds: float) -> int:
    return int(round(seconds * FPS))


@dataclass
class ClipPlan:
    index: int
    start_f: int            # timeline frame where this clip's main footage starts
    n: int                  # main footage length in frames (end_f - start_f)
    speed: float
    trim_in: float          # source seconds of the main footage's first frame
    pre_real: int = 0       # frames of real source before trim_in used as pre-roll (timeline frames)
    pre_hold: int = 0       # frames of repeated first frame (policy "hold")
    post_real: int = 0
    post_hold: int = 0
    fade_in: int = 0        # frames of fade-from-black at the start of the main footage
    fade_out: int = 0       # frames of fade-to-black at the end of the main footage

    @property
    def pre(self) -> int:
        return self.pre_real + self.pre_hold

    @property
    def post(self) -> int:
        return self.post_real + self.post_hold

    @property
    def total(self) -> int:
        """frames of the extended segment fed to the join graph"""
        return self.pre + self.n + self.post

    # the source range the segment is cut from (source seconds): main footage plus the REAL pre/post roll
    @property
    def source_trim_in(self) -> float:
        return self.trim_in - self.pre_real / FPS * self.speed

    @property
    def source_duration(self) -> float:
        return (self.pre_real + self.n + self.post_real) / FPS * self.speed


@dataclass
class JoinPlan:
    index: int               # join between clip index and index + 1
    kind: str                # 'cut' | 'fade' | 'blend'
    xfade: str | None = None
    join_f: int = 0          # timeline frame of the join J
    pre: int = 0             # x: window frames before J (the incoming clip's pre-roll)
    post: int = 0            # y: window frames after J (the outgoing clip's post-roll)
    requested: int = 0       # frames asked for by the transition duration
    note: str = ""

    @property
    def window(self) -> int:
        return self.pre + self.post


@dataclass
class TimelinePlan:
    clips: list[ClipPlan]
    joins: list[JoinPlan]
    origin_f: int
    total_f: int
    policy: str = "shorten"
    notes: list[str] = field(default_factory=list)

    @property
    def total_seconds(self) -> float:
        return self.total_f / FPS


def plan_timeline(clips: list[dict], xfade_names: dict[str, str | None], file_durations: dict[str, float | None] | None = None, policy: str = "shorten") -> TimelinePlan:
    """clips: the render_project clip dicts in timeline order (path, trim_in, start_time, end_time, speed, transition, transition_duration).
    xfade_names: transition name -> ffmpeg xfade name for blending transitions ('cut' and 'fade_black' are handled here and need no entry).
    file_durations: source file path -> seconds (None/missing = unknown, treated as having no spare frames after the trim-out)."""
    file_durations = file_durations or {}
    # Each clip's length is its OWN span (end - start), accumulated and rounded cumulatively, so a gap between two clips is never absorbed into the next clip's footage. A gap is still collapsed,
    # exactly as the exporter has always done (the editor shows black there); that is recorded as a known limitation, not changed here.
    bnd = [to_frames(clips[0]["start_time"])]
    cum = float(clips[0]["start_time"])
    for c in clips:
        cum += float(c["end_time"]) - float(c["start_time"])
        bnd.append(max(bnd[-1] + 1, to_frames(cum)))
    plans = [ClipPlan(i, bnd[i], bnd[i + 1] - bnd[i], float(c["speed"]), float(c["trim_in"])) for i, c in enumerate(clips)]

    def spare_before(i: int) -> int:
        p = plans[i]
        return max(0, int((p.trim_in / p.speed) * FPS) - 1)

    def spare_after(i: int) -> int:
        p, c = plans[i], clips[i]
        d = file_durations.get(c["path"])
        if d is None:
            return 0
        used_end = p.trim_in + p.n / FPS * p.speed
        return max(0, int(((d - used_end) / p.speed) * FPS) - 1)

    joins: list[JoinPlan] = []
    for j in range(len(clips) - 1):
        name = clips[j]["transition"]
        join_f = bnd[j + 1]
        if name == "cut":
            joins.append(JoinPlan(j, "cut", None, join_f))
        elif name in ("fade_black", "fade_to_black"):
            total = max(2, to_frames(clips[j].get("transition_duration", 0.5)))
            out_f = total // 2
            joins.append(JoinPlan(j, "fade", None, join_f, pre=0, post=0, requested=total, note=f"fade_out={out_f} fade_in={total - out_f}"))
        else:
            req = max(MIN_BLEND_FRAMES, to_frames(clips[j].get("transition_duration", 0.5)))
            x_req = req // 2
            y_req = req - x_req
            if policy == "hold":
                x, y = x_req, y_req
            elif policy == "hold_incoming":
                y = min(y_req, spare_after(j))              # the outgoing clip only ever continues with REAL frames; it is never frozen
                x = req - y                                  # the incoming clip supplies the rest: real pre-roll first, then its first frame repeated
            else:
                x = min(x_req, spare_before(j + 1))
                y = min(y_req, spare_after(j))
                left = req - x - y
                if left > 0:
                    add = min(left, spare_before(j + 1) - x); x += add; left -= add
                if left > 0:
                    add = min(left, spare_after(j) - y); y += add
            joins.append(JoinPlan(j, "blend", xfade_names.get(name) or "fade", join_f, pre=x, post=y, requested=req))

    # every clip's two window uses (start side: previous join's post / fade-in, end side: next join's pre / fade-out) must fit inside its own main footage; shrink proportionally
    def fade_split(jn: JoinPlan) -> tuple[int, int]:
        out_f = jn.requested // 2
        return out_f, jn.requested - out_f

    for _ in range(2):
        for k, p in enumerate(plans):
            start_use = 0
            end_use = 0
            if k > 0:
                pj = joins[k - 1]
                start_use = pj.post if pj.kind == "blend" else (fade_split(pj)[1] if pj.kind == "fade" else 0)
            if k < len(plans) - 1:
                nj = joins[k]
                end_use = nj.pre if nj.kind == "blend" else (fade_split(nj)[0] if nj.kind == "fade" else 0)
            if start_use + end_use > p.n:
                scale = p.n / (start_use + end_use)
                if k > 0:
                    pj = joins[k - 1]
                    if pj.kind == "blend":
                        pj.post = int(pj.post * scale)
                    elif pj.kind == "fade":
                        pj.requested = max(2, int(pj.requested * scale))
                if k < len(plans) - 1:
                    nj = joins[k]
                    if nj.kind == "blend":
                        nj.pre = int(nj.pre * scale)
                    elif nj.kind == "fade":
                        nj.requested = max(2, int(nj.requested * scale))
    for jn in joins:
        if jn.kind == "blend" and jn.window < MIN_BLEND_FRAMES:
            jn.kind, jn.xfade, jn.pre, jn.post, jn.note = "cut", None, 0, 0, "no spare source frames for a blend: hard cut"

    # realise windows on the clips: real source frames first, held edge frames for the rest (policy "hold" only)
    for jn in joins:
        out_p, in_p = plans[jn.index], plans[jn.index + 1]
        if jn.kind == "blend":
            real_post = min(jn.post, spare_after(jn.index))
            real_pre = min(jn.pre, spare_before(jn.index + 1))
            out_p.post_real, out_p.post_hold = real_post, jn.post - real_post
            in_p.pre_real, in_p.pre_hold = real_pre, jn.pre - real_pre
            if jn.window < jn.requested:
                jn.note = f"blend shortened from {jn.requested} to {jn.window} frames (spare source frames: before={spare_before(jn.index + 1)}, after={spare_after(jn.index)})"
        elif jn.kind == "fade":
            out_f, in_f = fade_split(jn)
            out_p.fade_out, in_p.fade_in = out_f, in_f

    return TimelinePlan(plans, joins, bnd[0], bnd[-1], policy)


def split_runs(clips: list[dict]) -> list[list[dict]]:
    """Group the V1 clips (timeline order) into CONTIGUOUS runs: a new run starts wherever the next clip begins at least one whole frame after the previous one ends. The editor shows black
    and silence in such a gap; the exporter joins the runs with exactly that (see ffmpeg_svc.concat_runs_with_gaps). A project without a gap is a single run."""
    runs: list[list[dict]] = [[clips[0]]]
    for prev, c in zip(clips, clips[1:]):
        if to_frames(c["start_time"]) - to_frames(prev["end_time"]) >= 1:
            runs.append([c])
        else:
            runs[-1].append(c)
    return runs
