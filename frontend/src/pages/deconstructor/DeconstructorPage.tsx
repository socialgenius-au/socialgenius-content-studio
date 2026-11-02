// C5 -- Deconstructor -> Reconstructor workspace: ONE page, six steps (Reference / Anatomy / Mechanisms / New content / Blueprint / Create).
// It reuses the existing reference-video, deconstruction, anatomy, mechanism and blueprint APIs and hands the finished blueprint to the
// EXISTING Video Studio V2 (route /video-studio-v2) -- there is no parallel editor here.
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/PageHeader'
import { buildBlueprintPlan, checkBlueprintUsable } from '../video-studio-v2/blueprint/blueprintPlan'
import { createStudioDraftFromBlueprint } from '../video-studio-v2/blueprint/createStudioDraft'
import { emptyIntentForm, validateIntentForm, type IntentErrors, type IntentForm } from './intentForm'
import { useDeconstructor } from './useDeconstructor'
import { anatomyReady, mechanismsView } from './viewModel'
import { AnatomyStage, BlueprintStage, CreateStage, IntentStage, MechanismsStage, ReferenceStage } from './stages'
import { FootageAssignment } from './footage'
import { TextLayersReview } from './textlayers/TextLayersReview'
import type { TextLayerPlan } from './textlayers'
import { ImageLayersReview } from './imagelayers/ImageLayersReview'
import type { ImageLayerPlan } from './imagelayers'
import { TransitionsReview } from './transitions/TransitionsReview'
import type { TransitionPlan } from './transitions'
import { TranscriptReview } from './transcript/TranscriptReview'
import type { SpeechPlan } from './transcript'
import { BackgroundReview } from './background/BackgroundReview'
import type { BackgroundPlan, OrderPolicy, SceneFootage } from './background'

type Step = 'reference' | 'anatomy' | 'mechanisms' | 'intent' | 'blueprint' | 'create'

const STEPS: { id: Step; label: string; caption: string }[] = [
  { id: 'reference', label: 'Reference', caption: 'Pick a video' },
  { id: 'anatomy', label: 'Anatomy', caption: 'What the reference did' },
  { id: 'mechanisms', label: 'Mechanisms', caption: 'Principles learned' },
  { id: 'intent', label: 'New content', caption: 'What we will apply' },
  { id: 'blueprint', label: 'Blueprint', caption: 'How it will be built' },
  { id: 'create', label: 'Create', caption: 'Open in Video Studio' },
]

const AI_CONFIRM = {
  deconstruct: 'Deconstruct this reference video?\n\nThis runs the analysis pipeline. Where an AI provider is configured, some steps use AI and may incur usage cost. Steps already completed are skipped.',
  mechanisms: 'Derive mechanisms with AI?\n\nThis sends the reference video’s analysed structure to an AI provider and may incur usage cost.',
  blueprint: 'Build a NEW reconstruction blueprint with AI?\n\nThis sends your new-content details and the learned mechanisms to an AI provider and may incur usage cost. The existing blueprint (if any) is kept in history.',
}

const textlessPictures = (p: ImageLayerPlan | null) => (p ? p.overlays : [])

export default function DeconstructorPage() {
  const params = useParams<{ referenceVideoId?: string }>()
  const navigate = useNavigate()
  const routeId = params.referenceVideoId && /^\d+$/.test(params.referenceVideoId) ? Number(params.referenceVideoId) : null
  const [step, setStep] = useState<Step>('reference')
  const [form, setForm] = useState<IntentForm>(emptyIntentForm)
  const [errors, setErrors] = useState<IntentErrors>({})
  const [using, setUsing] = useState(false)
  // Preview panels are switched on by the address: ?m2=<name> for one, or a comma-separated list (?m2=text-layers,image-layers,background) to use several in one draft.
  // Without ?m2 the approved page is unchanged for everyone else.
  const m2Param = useSearchParams()[0].get('m2') ?? ''
  const m2Has = (name: string) => m2Param.split(',').map(f => f.trim()).includes(name)
  // M2.1a (preview): the text-layer review is shown only with ?m2=text-layers.
  const textLayersOn = m2Has('text-layers')
  const [textLayers, setTextLayers] = useState<TextLayerPlan | null>(null)
  // M2.2a (preview): same rule for the image-layer review -- only with ?m2=image-layers.
  const imageLayersOn = m2Has('image-layers')
  const [imageLayers, setImageLayers] = useState<ImageLayerPlan | null>(null)
  // M2.4a (preview): same rule for the transition review -- only with ?m2=transitions.
  const transitionsOn = m2Has('transitions')
  const [transitionPlan, setTransitionPlan] = useState<TransitionPlan | null>(null)
  // M2.5a (preview): same rule for the transcript review -- only with ?m2=transcript.
  const transcriptOn = m2Has('transcript')
  const [speechPlan, setSpeechPlan] = useState<SpeechPlan | null>(null)
  // M2.3 (preview): same rule for the background plates and the stacking policy -- only with ?m2=background.
  const backgroundOn = m2Has('background')
  const [backgroundPlan, setBackgroundPlan] = useState<BackgroundPlan | null>(null)
  const [compositionPolicy, setCompositionPolicy] = useState<OrderPolicy>('as_generated')
  const [sceneFootage, setSceneFootage] = useState<SceneFootage>({})
  const [useMessage, setUseMessage] = useState<string | null>(null)

  const d = useDeconstructor(routeId)
  const anatomyAvailable = anatomyReady(d.anatomy.data)
  const mech = mechanismsView(d.mechanisms.data)
  const mechanismsReady = mech.state !== 'none'
  const busy = using ? 'use' : d.busy

  const select = (id: number) => { setUseMessage(null); navigate(`/deconstructor/${id}`) }

  const onDeconstruct = () => { if (window.confirm(AI_CONFIRM.deconstruct)) void d.deconstruct() }
  const onDerive = () => { if (window.confirm(AI_CONFIRM.mechanisms)) void d.deriveMechanisms() }

  const onBuild = async () => {
    const v = validateIntentForm(form)
    setErrors(v.errors)
    if (!v.ok || !v.intent) return
    if (!window.confirm(AI_CONFIRM.blueprint)) return
    const r = await d.buildBlueprint(v.intent)
    if (r) { setUseMessage(null); setStep('blueprint') }
  }

  const onUse = async () => {
    setUsing(true); setUseMessage(null)
    try {
      const res = await createStudioDraftFromBlueprint(d.blueprint.data)
      if (res.ok) navigate(res.route)
      else setUseMessage(res.message)
    } finally { setUsing(false) }
  }

  const sceneSummary = useMemo(() => {
    if (!checkBlueprintUsable(d.blueprint.data).ok) return null
    const plan = buildBlueprintPlan(d.blueprint.data!)
    return { n: plan.scenes.length, seconds: plan.totalSeconds }
  }, [d.blueprint.data])

  // M1 / Stage 2: the same plan the blueprint step shows, handed to the Footage Assignment panel inside the Create step.
  const plan = useMemo(() => (checkBlueprintUsable(d.blueprint.data).ok ? buildBlueprintPlan(d.blueprint.data!) : null), [d.blueprint.data])

  const needsRef = step !== 'reference' && routeId == null

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6" data-testid="deconstructor-page">
      <PageHeader title="Reconstruct from a reference" description="Learn how a reference video works, then plan new content that applies the same principles — without copying it." />

      <nav aria-label="Steps" className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s.id} onClick={() => setStep(s.id)} data-testid={`step-${s.id}`} aria-current={step === s.id ? 'step' : undefined}
            className={`rounded-lg border px-3 py-1.5 text-left text-xs transition ${step === s.id ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}
          >
            <div className="font-semibold">{i + 1}. {s.label}</div>
            <div className="text-[11px] text-muted-foreground">{s.caption}</div>
          </button>
        ))}
      </nav>

      {d.actionError && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span>{d.actionError}</span>
          <button className="text-xs underline" onClick={() => d.setActionError(null)}>Dismiss</button>
        </div>
      )}

      {needsRef ? (
        <div className="rounded-xl border bg-card p-6 text-sm">Pick a reference video first. <button className="underline" onClick={() => setStep('reference')}>Go to Reference</button></div>
      ) : (
        <>
          {step === 'reference' && (
            <ReferenceStage
              references={d.references} selectedId={routeId} onSelect={select} progress={d.progress} busy={d.busy} anatomyAvailable={anatomyAvailable}
              onDeconstruct={onDeconstruct} onRetry={() => window.location.reload()}
              onAdd={async f => { const id = await d.addReference(f); if (id != null) select(id) }}
            />
          )}
          {step === 'anatomy' && <AnatomyStage anatomy={d.anatomy} />}
          {step === 'mechanisms' && <MechanismsStage mechanisms={d.mechanisms} anatomyAvailable={anatomyAvailable} busy={d.busy} onDerive={onDerive} />}
          {step === 'intent' && (
            <IntentStage
              form={form} errors={errors} set={(k, v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })) }}
              mechanismsReady={mechanismsReady} busy={d.busy} onBuild={() => void onBuild()} hasExistingBlueprint={!!d.blueprint.data?.blueprint}
            />
          )}
          {step === 'blueprint' && <BlueprintStage blueprint={d.blueprint} busy={busy} onUse={() => void onUse()} onNew={() => setStep('intent')} useMessage={useMessage} />}
          {step === 'create' && <CreateStage blueprint={d.blueprint} busy={busy} onUse={() => void onUse()} sceneSummary={sceneSummary} useMessage={useMessage} />}
          {step === 'create' && plan && textLayersOn && <TextLayersReview key={`text:${routeId}:${plan.blueprintId}`} plan={plan} onPlan={setTextLayers} />}
          {step === 'create' && plan && imageLayersOn && <ImageLayersReview key={`image:${routeId}:${plan.blueprintId}`} plan={plan} onPlan={setImageLayers} />}
          {step === 'create' && plan && transitionsOn && <TransitionsReview key={`tr:${routeId}:${plan.blueprintId}`} plan={plan} onPlan={setTransitionPlan} />}
          {step === 'create' && plan && transcriptOn && <TranscriptReview key={`sp:${routeId}:${plan.blueprintId}`} plan={plan} onPlan={setSpeechPlan} />}
          {step === 'create' && plan && backgroundOn && <BackgroundReview key={`bg:${routeId}:${plan.blueprintId}`} plan={plan} footage={sceneFootage} generated={{ shapes: [], mediaOverlays: textlessPictures(imageLayersOn ? imageLayers : null), textOverlays: textLayersOn && textLayers ? textLayers.overlays : [], subtitles: transcriptOn && speechPlan ? speechPlan.subtitles : [] }} onPlan={setBackgroundPlan} onPolicy={setCompositionPolicy} />}
          {step === 'create' && plan && <FootageAssignment key={`${routeId}:${plan.blueprintId}`} resp={d.blueprint.data} plan={plan} references={d.references.data} textLayers={textLayersOn ? textLayers : null} imageLayers={imageLayersOn ? imageLayers : null} transitionPlan={transitionsOn ? transitionPlan : null} speechPlan={transcriptOn ? speechPlan : null} backgroundPlan={backgroundOn ? backgroundPlan : null} compositionPolicy={backgroundOn ? compositionPolicy : null} onFootage={backgroundOn ? setSceneFootage : undefined} />}
        </>
      )}
    </div>
  )
}
