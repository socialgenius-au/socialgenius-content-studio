import { describe, it, expect } from "vitest";
import {
  findActiveClip, computeEndTimeForSpeed,
  computeInsertTrimLeft, computeInsertTrimRight, defaultBrollAudioMode,
} from "./videoPreviewUtils";
import type { VideoClip } from "../../types";

// Video Editor Playback Regression (found via Sameena's Stage-4 manual test) — regression suite
// for findActiveClip, the ONE function that decides which V1 clip is active at a given
// timeline.currentTime (see this file's own module docstring and its Manual Test 7.2 fix note
// for the full history this builds on). This project has no frontend test runner at all before
// this fix — Vitest was added specifically to make this regression testable; see the
// implementation report for why, and for what this suite deliberately does NOT cover (real
// <video>/<audio> element sync, overlay continuation, and audio sync all need jsdom + fake
// media elements, which this suite does not set up — it covers the pure clip-selection logic
// only, which is where the actual verified defect data anomaly lives).

function makeClip(overrides: Partial<VideoClip> & Pick<VideoClip, "id" | "startTime" | "endTime">): VideoClip {
  return {
    url: "blob://test", name: overrides.id, duration: 100, trimIn: 0, trimOut: 0,
    colorGrade: "none", speed: 1, brightness: 0, contrast: 0, saturation: 0,
    transition: "cut", transitionDuration: 0.5,
    ...overrides,
  };
}

describe("findActiveClip — V1 clip A -> B -> C continuous playback", () => {
  const a = makeClip({ id: "A", startTime: 0, endTime: 5 });
  const b = makeClip({ id: "B", startTime: 5, endTime: 10 });
  const c = makeClip({ id: "C", startTime: 10, endTime: 15 });
  const clips = [a, b, c];

  it("returns the correct clip well inside each clip's own range", () => {
    expect(findActiveClip(clips, 2)?.id).toBe("A");
    expect(findActiveClip(clips, 7)?.id).toBe("B");
    expect(findActiveClip(clips, 12)?.id).toBe("C");
  });

  it("hands off to the NEXT clip exactly at a shared boundary — never double-matches, never drops", () => {
    // The overwhelmingly common case: clip2.startTime === clip1.endTime exactly (split/back-
    // to-back authoring). The active source must switch cleanly, not stay on the outgoing clip.
    expect(findActiveClip(clips, 4.999999)?.id).toBe("A");
    expect(findActiveClip(clips, 5)?.id).toBe("B");
    expect(findActiveClip(clips, 10)?.id).toBe("C");
  });

  it("seeking across a boundary (not just ticking through it) resolves identically", () => {
    // findActiveClip is pure/stateless — a seek is just calling it with a different time. This
    // is here explicitly because "seeking across boundaries" was named as a required check.
    expect(findActiveClip(clips, 0)?.id).toBe("A");
    expect(findActiveClip(clips, 9.999)?.id).toBe("B");
    expect(findActiveClip(clips, 5.0001)?.id).toBe("B");
    expect(findActiveClip(clips, 14.9999)?.id).toBe("C");
  });

  it("end-of-timeline: freezes on the chronologically last clip, never returns null past the end", () => {
    expect(findActiveClip(clips, 15)?.id).toBe("C");
    expect(findActiveClip(clips, 999)?.id).toBe("C");
  });

  it("before the first clip's start returns null (nothing authored there yet)", () => {
    expect(findActiveClip(clips, -1)).toBeNull();
  });

  it("tolerates tiny float drift on a clip's START only, never on its END", () => {
    // videoPreviewUtils.ts's own documented rationale: drag/trim/split math can leave a
    // clip's startTime a hair above a clean value (e.g. 5 + 1e-13) — CLIP_BOUNDARY_EPSILON
    // must still match it. The END must stay a hard bound or two adjacent clips both match
    // the shared instant at once.
    const drifted = [
      makeClip({ id: "A", startTime: 1e-13, endTime: 5 }),
      makeClip({ id: "B", startTime: 5, endTime: 10 }),
    ];
    expect(findActiveClip(drifted, 0)?.id).toBe("A");
    expect(findActiveClip(drifted, 5)?.id).toBe("B"); // exact shared boundary, not double-matched
  });
});

describe("findActiveClip — overlapping clips (Sameena's real saved draft shape)", () => {
  // Reproduces the EXACT relationship found in Sameena's real ABC Tiles draft: clip2.startTime
  // (11.37948883422061) is LESS than clip1.endTime (11.77078937048495) — a ~0.39s overlap, not
  // a clean shared boundary. This is a genuine, verified data inconsistency (see the
  // implementation report) — this test documents and locks in how the existing selection logic
  // already resolves it, so a future change can't silently make it worse.
  const clip1 = makeClip({ id: "clip1", startTime: 0, endTime: 11.77078937048495, speed: 2 });
  const clip2 = makeClip({ id: "clip2", startTime: 11.37948883422061, endTime: 30.642866463735658, speed: 1 });
  const clips = [clip1, clip2];

  it("clip1 stays active throughout the overlap zone (first array match wins)", () => {
    expect(findActiveClip(clips, 11.4)?.id).toBe("clip1");
    expect(findActiveClip(clips, 11.6)?.id).toBe("clip1");
    expect(findActiveClip(clips, 11.77078937048494)?.id).toBe("clip1");
  });

  it("clip2 takes over the instant clip1's own endTime is reached", () => {
    expect(findActiveClip(clips, 11.77078937048495)?.id).toBe("clip2");
    expect(findActiveClip(clips, 15)?.id).toBe("clip2");
  });
});

describe("findActiveClip — a genuine gap between clips", () => {
  it("returns null inside a gap — no clip incorrectly claims that time", () => {
    const clips = [
      makeClip({ id: "A", startTime: 0, endTime: 5 }),
      makeClip({ id: "B", startTime: 7, endTime: 10 }), // 2s gap
    ];
    expect(findActiveClip(clips, 6)?.id ?? null).toBeNull();
    expect(findActiveClip(clips, 4.9)?.id).toBe("A");
    expect(findActiveClip(clips, 7)?.id).toBe("B");
  });
});

describe("computeEndTimeForSpeed — Speed control fix (Video Editor Playback Regression)", () => {
  it("keeps a clip's own trimmed source range internally consistent when speed changes", () => {
    // A clip trimmed to a 10s span of a 30s source, authored at speed=1 (endTime=10).
    const clip = { startTime: 0, duration: 30, trimIn: 0, trimOut: 20 };
    // Doubling speed must halve the ON-TIMELINE duration needed to play that SAME 10s of
    // trimmed source — never leave endTime fixed at the old (speed=1) value.
    expect(computeEndTimeForSpeed(clip, 2)).toBeCloseTo(5, 6);
    expect(computeEndTimeForSpeed(clip, 0.5)).toBeCloseTo(20, 6);
    expect(computeEndTimeForSpeed(clip, 1)).toBeCloseTo(10, 6);
  });

  it("would have kept Sameena's real clip1 internally consistent instead of overrunning its trim", () => {
    // Reproduces her exact saved numbers: duration=31.034167, trimIn=0, trimOut=19.26337762951505
    // — the endTime her draft actually has (11.77078937048495) is EXACTLY what this function
    // would compute for speed=1, confirming the saved data was correct before the speed change,
    // and that the missing recompute at speed=2 is exactly what let it drift out of sync.
    const clip1 = { startTime: 0, duration: 31.034167, trimIn: 0, trimOut: 19.26337762951505 };
    expect(computeEndTimeForSpeed(clip1, 1)).toBeCloseTo(11.77078937048495, 6);
    // At speed=2 (what her clip1 was actually switched to), the correct endTime is HALF that —
    // not the unchanged speed=1 value her saved draft still carries.
    expect(computeEndTimeForSpeed(clip1, 2)).toBeCloseTo(5.885394685242475, 6);
  });

  it("never produces a zero/negative-length clip even at extreme speed", () => {
    const clip = { startTime: 3, duration: 10, trimIn: 9.99, trimOut: 0 };
    expect(computeEndTimeForSpeed(clip, 2)).toBeGreaterThan(3);
  });
});

describe("findActiveClip — clips not stored in chronological array order", () => {
  it("still resolves by actual time range, not array position", () => {
    // videoPreviewUtils.ts's own docstring: "Clips aren't necessarily stored in chronological
    // order (dragging a clip's body can move its startTime past another's)".
    const clips = [
      makeClip({ id: "second", startTime: 5, endTime: 10 }),
      makeClip({ id: "first", startTime: 0, endTime: 5 }),
    ];
    expect(findActiveClip(clips, 2)?.id).toBe("first");
    expect(findActiveClip(clips, 8)?.id).toBe("second");
  });
});

// Phase 1 (V2 Inserts/B-roll) — same "V1 must remain unchanged" spirit as this suite's existing
// coverage: findActiveClip above is reused as-is for additionalVideoClips (V2), so it needs no
// new tests of its own here; what's genuinely new is the trim-clamp math and the B-roll-audio
// default, both extracted as pure functions specifically so they're independently verifiable.

describe("computeInsertTrimLeft / computeInsertTrimRight — V2 trim clamp math", () => {
  const MIN = 0.2; // mirrors CreateEditTab.tsx's own MIN_CLIP_DURATION

  it("moves the start forward/back within the un-trimmed source range", () => {
    const clip = { startTime: 5, endTime: 15, trimIn: 2 }; // 2s already trimmed off the front
    expect(computeInsertTrimLeft(clip, 8, MIN)).toEqual({ startTime: 8, trimIn: 5 });
    expect(computeInsertTrimLeft(clip, 4, MIN)).toEqual({ startTime: 4, trimIn: 1 });
  });

  it("never reveals source material earlier than the file actually has", () => {
    // trimIn=2 means the earliest legal startTime is 5 - 2 = 3, however far left proposedStart asks.
    const clip = { startTime: 5, endTime: 15, trimIn: 2 };
    expect(computeInsertTrimLeft(clip, -50, MIN)).toEqual({ startTime: 3, trimIn: 0 });
  });

  it("never trims a clip down to less than MIN_CLIP_DURATION", () => {
    const clip = { startTime: 5, endTime: 15, trimIn: 0 };
    const result = computeInsertTrimLeft(clip, 14.9, MIN);
    expect(result.startTime).toBeCloseTo(15 - MIN, 6);
  });

  it("mirrors the same three rules on the right/end edge", () => {
    const clip = { startTime: 5, endTime: 15, trimOut: 3 }; // 3s of source still available past endTime
    expect(computeInsertTrimRight(clip, 12, MIN)).toEqual({ endTime: 12, trimOut: 6 });
    expect(computeInsertTrimRight(clip, 999, MIN)).toEqual({ endTime: 18, trimOut: 0 }); // can't exceed endTime+trimOut
    const floored = computeInsertTrimRight(clip, 5.05, MIN);
    expect(floored.endTime).toBeCloseTo(5 + MIN, 6);
  });
});

describe("defaultBrollAudioMode — Requirement 9 ('do NOT blindly mix unwanted audio')", () => {
  it("a V2 clip with detected embedded audio starts muted, never auto-audible", () => {
    expect(defaultBrollAudioMode(true)).toBe("muted");
  });

  it("a silent V2 clip gets no B-roll audio state at all — nothing to choose", () => {
    expect(defaultBrollAudioMode(false)).toBeUndefined();
  });
});
