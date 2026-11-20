# Deconstructor creative intelligence — audit and completion

## What was already working (not rebuilt)
Hook reasoner (type, secondary types, intent, evidence-cited elements), Creative Read (AI reading of keyframes), reconciliation of unequal-authority readings, mechanism reasoner (v3, consumes the Creative Read), blueprint reasoner with its safeguards, JSON recovery / `invalid_output` ledger status / bounded retry, signed media, lessons.

## Deficiencies found on reference 5131 (from its stored data) and the fix for each
| # | Deficiency | Fix |
|---|---|---|
| 1 | **Stage 10 was reported "already complete" whenever a scene existed**, even when a story-beat candidate had no stored reasoning. This is why 5131's story-beat run stayed incomplete after the malformed-JSON failure. | The completion probe now also requires that no configured reasoner has candidates left without a stored result. The finishing run is bounded: it reasons only about unreasoned candidates; a stored "no" or "undecided" is never offered again. |
| 2 | **Undecided boundary candidates were invisible.** 3 of 7 story-beat candidates were undecided and 4 were "no"; the only trace was one whole-video beat. | `video.structure.reasoning` counts examined / accepted / rejected / undecided / low-confidence-boundary, with the evidence each cited, and `structure.uncertainty` says in plain words that this is a text-only reasoner's judgement, not proof the video has no structure. |
| 3 | **No scene↔shot or beat↔timestamp mapping** (`Shot.scene_id` is never set) and no consistency check. | `structure_integrity.analyze_structure`: explicit time-overlap mapping of every shot to scenes and beats, and checks for gaps, overlaps, out-of-video, shots in no scene, beats outside their scene. |
| 4 | **The anatomy dropped the hook's elements**, so channel and timing were lost and coexisting hooks could not be explained. | Elements are carried into the anatomy; `video.hook_profile` gives each element's channel (spoken / on-screen text / visual / editing-framing), timing, evidence and reliability, how coexisting types and channels relate, the visual reading alongside the text-only classification, contradictions, and what is unsupported. |
| 5 | **No narrative progression** (narrative roles were "unsupported in v1" for every section). | `video.narrative`: the progression assembled from what the AI already read in each section's frames (role from the mechanism it named); sections with no reading stay unknown and are counted. Not established when there is no Creative Read. |
| 6 | **Mechanisms carried a bare principle**: no purpose, no typed evidence with timestamps and reliability, no conditions of use, no adaptation guidance. | `creative_intelligence.build_creative_intelligence` (`GET /reference-videos/{id}/creative-intelligence`): per mechanism, purpose, evidence by channel with section/time/reliability, confidence and limitations, when it applies / when to avoid it / how to adapt it (a documented rule table, labelled as such), and the reuse-versus-copy split. Contradictions and the audience-effects statement are listed. |
| 7 | **The planner and the person did not see any of it.** | New Content shows "What this reference teaches". The blueprint planner receives per-mechanism `reuse_guidance` and the opening's structure (no wording, no description of the reference's subject) and is told to mark a mechanism NOT_USED when an avoid condition holds. Mechanism prompt v4 and blueprint prompt v5. |

## Principles kept
- **Three kinds of statement are always separate**: observed (stored evidence, timing), AI interpretation (types, intents, names, roles, the visual reading) and unsupported (anything about audience behaviour: never claimed).
- **Reuse the mechanism, never copy the content**: the planner gets structure, conditions and reliability; the existing source-copy guards are unchanged.
- **No AI call** is made by anything in this change. `AI_SPEND_ENABLED` is unchanged (off).
- **Existing results stay valid**: the new views are attached after the anatomy fingerprint is taken, so existing mechanisms and blueprints are not made stale.

## Needs the live acceptance test
The mechanism (v4) and blueprint (v5) prompts now include the new inputs. They take effect when the mechanisms are next derived and a blueprint is next built; until then the stored results were produced by v3/v4 and do not reflect them. The rule-table conditions are generic per mechanism type; AI-written, reference-specific conditions are a possible later improvement.
