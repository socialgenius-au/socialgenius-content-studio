// M2.6 -- container: builds the manifest from the plans the Deconstructor page already holds. Pure derivation, no I/O, nothing written.
import { useMemo } from 'react'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { planComposition, type OrderPolicy } from '../background/composition'
import type { BackgroundPlan } from '../background/materialize'
import type { ImageLayerPlan } from '../imagelayers/materialize'
import type { SpeechPlan } from '../transcript/materialize'
import type { TextLayerPlan } from '../textlayers/materialize'
import type { TransitionPlan } from '../transitions/materialize'
import { buildManifest } from './manifest'
import { ManifestView } from './ManifestView'

export interface ReconstructionManifestProps {
  plan: BlueprintPlan
  textLayers: TextLayerPlan | null
  imageLayers: ImageLayerPlan | null
  backgroundPlan: BackgroundPlan | null
  speechPlan: SpeechPlan | null
  transitionPlan: TransitionPlan | null
  compositionPolicy: OrderPolicy
}

export function ReconstructionManifest({ plan, textLayers, imageLayers, backgroundPlan, speechPlan, transitionPlan, compositionPolicy }: ReconstructionManifestProps) {
  const manifest = useMemo(() => {
    const generated = { shapes: backgroundPlan ? backgroundPlan.shapes : [], mediaOverlays: imageLayers ? imageLayers.overlays : [], textOverlays: textLayers ? textLayers.overlays : [], subtitles: speechPlan ? speechPlan.subtitles : [] }
    return buildManifest({
      scenes: plan.scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime })), textLayers, imageLayers, backgroundPlan, speechPlan, transitionPlan,
      composition: { plan: planComposition(generated, compositionPolicy), policy: compositionPolicy },
    })
  }, [plan.scenes, textLayers, imageLayers, backgroundPlan, speechPlan, transitionPlan, compositionPolicy])
  return <ManifestView manifest={manifest} />
}
