import { useEffect, useMemo, useState } from "react";
import { useStudio } from "../../../contexts/StudioContext";
import { learningApi } from "../../../api/client";
import { useBlueprintPlan } from "../blueprint/blueprintPlanStore";
import { useProjectContext } from "../identity/projectContextStore";
import { resolveProjectIdentity } from "../identity/projectIdentity";
import { aiStructure, assessProject } from "../learn/assessment";
import { buildRecommendations, type Recommendation } from "../learn/recommendations";
import { parseVerifiedPerformance } from "../learn/performance";
import LearnView, { type Decision, type Lesson, type SavedDecision } from "../learn/LearnView";

// The Learn stage used to be a hard-coded demonstration dashboard (invented reach/engagement figures, a fake trend chart, canned insights about "ABC Tiles" and a button that did nothing).
// It now shows only what exists: no audience figures (none are measured yet), clearly separated AI / rule-based assessments of THIS project, and grounded recommendations whose status can be recorded
// against the saved draft. See ../learn/*.

interface ApiRecord { rec_key: string; status: Decision; note: string | null }
interface ApiLesson { id: number; text: string; basis: string; draft_name: string; evidence: string[]; caveat: string | null; note: string | null; updated_at: string }

export default function LearnTab({ onBack }: { onBack?: () => void; onNext?: () => void }) {
  const studio = useStudio();
  const plan = useBlueprintPlan();
  const ctx = useProjectContext();
  const identity = resolveProjectIdentity({ plan, stored: ctx.storedIdentity });
  const [decisions, setDecisions] = useState<Record<string, SavedDecision>>({});
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(() => assessProject({
    canvas: { width: studio.canvasFormat.width, height: studio.canvasFormat.height },
    clips: studio.videoClips.map(c => ({ startTime: c.startTime, endTime: c.endTime, assetId: c.assetId ?? null, muted: c.muted })),
    texts: studio.textOverlays.map(t => ({ text: t.text, startTime: t.startTime, endTime: t.endTime, fontSize: t.fontSize, color: t.color, bgColor: t.bgColor, bgOpacity: t.bgOpacity })),
    audioTrackCount: studio.audioTracks.length,
    plan,
  }), [studio.canvasFormat.width, studio.canvasFormat.height, studio.videoClips, studio.textOverlays, studio.audioTracks.length, plan]);
  const recommendations = useMemo(() => buildRecommendations(assessment), [assessment]);

  useEffect(() => {
    let live = true;
    setDecisions({}); setError(null);
    if (ctx.draftId == null) { setLessons([]); return () => { live = false; }; }
    learningApi.forDraft(ctx.draftId)
      .then(r => { if (live) setDecisions(Object.fromEntries((r.data as ApiRecord[]).map(x => [x.rec_key, { status: x.status, note: x.note }]))); })
      .catch(() => { if (live) setError("Could not load your earlier decisions for this video."); });
    learningApi.accepted(ctx.draftId)
      .then(r => { if (live) setLessons((r.data as ApiLesson[]).map(l => ({ id: l.id, text: l.text, basis: l.basis, draftName: l.draft_name, evidence: l.evidence, caveat: l.caveat, note: l.note, updatedAt: l.updated_at }))); })
      .catch(() => { if (live) setLessons([]); });
    return () => { live = false; };
  }, [ctx.draftId]);

  const onDecide = async (rec: Recommendation, status: Decision, note: string) => {
    if (ctx.draftId == null) return;
    setBusyKey(rec.key); setError(null);
    try {
      await learningApi.setStatus(ctx.draftId, rec.key, { status, note: note.trim() || null, text: rec.text, basis: rec.basis, evidence: rec.evidence, caveat: rec.caveat, rule_version: rec.ruleVersion });
      setDecisions(d => ({ ...d, [rec.key]: { status, note: note.trim() || null } }));
    } catch {
      setError("Could not save that decision — please try again.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <LearnView
      identity={identity}
      performance={parseVerifiedPerformance(null)}   // no analytics source is connected, so this is always "not available" today
      assessment={assessment}
      ai={aiStructure(plan)}
      recommendations={recommendations}
      decisions={decisions}
      canRecord={ctx.draftId != null}
      busyKey={busyKey}
      error={error}
      lessons={lessons}
      onDecide={onDecide}
      onBack={onBack}
    />
  );
}
