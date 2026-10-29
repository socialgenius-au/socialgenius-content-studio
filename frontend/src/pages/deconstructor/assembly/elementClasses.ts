// What the assembly engine can rebuild as real editor elements, what it can only describe, and what is flattened inside the reference and is
// therefore NEVER treated as editable. This table is the single source of truth; it is stored on every assembled draft.
import type { ElementClass, ElementKind } from './types'

export const ELEMENT_CLASSES: readonly ElementClass[] = [
  // ── automatic: rebuilt as real Video Studio V2 elements ──
  { kind: 'scene_structure', editability: 'automatic', reason: 'Scene order and timing come from the blueprint and are laid out on the timeline.' },
  { kind: 'clip_placement', editability: 'automatic', reason: 'The footage you supply becomes real video clips placed at each scene’s start.' },
  { kind: 'clip_trim', editability: 'automatic', reason: 'Each clip is trimmed to its scene; the trim values are real and editable in the editor.' },
  { kind: 'clip_speed', editability: 'automatic', reason: 'Speed is one of the editor’s own clip properties (only used when you pick it, or when a short clip is stretched).' },
  { kind: 'text_placeholder', editability: 'automatic', reason: 'A real, editable text overlay that holds the blueprint’s instruction. It is a placeholder to replace, not final copy.' },
  { kind: 'cta_placeholder', editability: 'automatic', reason: 'A real, editable text overlay for the call to action, created only for scenes the blueprint marks as carrying one.' },

  // ── partial: the editor can hold these, but assembly cannot generate them from the blueprint ──
  { kind: 'transition', editability: 'partial', reason: 'The blueprint gives plain-language direction and the editor has five fixed transition types, so no automatic mapping is made. Clips start as cuts; the direction is kept in the scene’s notes.' },
  { kind: 'voiceover', editability: 'partial', reason: 'The blueprint’s speech direction is kept as an instruction. No voice is generated; you record or upload audio.' },
  { kind: 'music', editability: 'partial', reason: 'No music is selected or generated; you add an audio track in the editor.' },
  { kind: 'captions', editability: 'partial', reason: 'The editor can transcribe and caption, but assembly does not create captions.' },
  { kind: 'lower_third', editability: 'partial', reason: 'Editable in the editor, not generated here. Note: the current export button does not yet send lower thirds.' },
  { kind: 'shape', editability: 'partial', reason: 'Editable in the editor, not generated here. Note: the current export button does not yet send shapes.' },

  // ── unsupported: flattened inside the reference video ──
  { kind: 'reference_footage', editability: 'unsupported', reason: 'The reference video’s own footage is never reused: a reconstruction applies its principles to your media, it does not copy it.' },
  { kind: 'reference_burned_in_text', editability: 'unsupported', reason: 'Text burned into the reference’s frames is flattened pixels, not a separate element, and is not copied or re-created as editable text.' },
  { kind: 'reference_graphics', editability: 'unsupported', reason: 'Graphics and logos baked into the reference’s frames cannot be separated from the picture.' },
  { kind: 'reference_color_grade', editability: 'unsupported', reason: 'The reference’s colour treatment is baked into its pixels and is not extracted as editable settings.' },
  { kind: 'reference_effects', editability: 'unsupported', reason: 'Effects and filters applied to the reference are baked in and cannot be recovered as editable effects.' },
  { kind: 'reference_audio_mix', editability: 'unsupported', reason: 'The reference’s mixed audio cannot be split back into editable tracks.' },
]

const BY_KIND: ReadonlyMap<ElementKind, ElementClass> = new Map(ELEMENT_CLASSES.map(c => [c.kind, c]))

export function classifyElement(kind: ElementKind): ElementClass {
  const c = BY_KIND.get(kind)
  if (!c) throw new Error(`Unknown element kind: ${String(kind)}`)
  return c
}

export const ALL_ELEMENT_KINDS: readonly ElementKind[] = ELEMENT_CLASSES.map(c => c.kind)
