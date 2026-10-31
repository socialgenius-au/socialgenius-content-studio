// Post Document — semantic roles.
//
// A role says WHY an element exists ("this is the primary call to action"), not what it looks like. Later features act on roles:
// AI creation (which slot to fill), platform adaptation and layout priority, safe-area handling, Brand Kit styling by role,
// accessibility (alt text, contrast, reading order), AI Select ("replace the hero image") and template reuse (map content by role).
// Keep this list small and controlled; `other` is the documented escape hatch.

export const POST_ELEMENT_ROLES = [
  // text
  'primary_headline',
  'secondary_headline',
  'supporting_text',
  'body_text',
  'price',
  'proof_point',
  /** Disclaimers / terms: never dropped, never shrunk below a legibility floor. */
  'legal_text',
  // imagery
  'hero_image',
  'product_image',
  'brand_logo',
  // calls to action and badges
  'primary_cta',
  'secondary_cta',
  'badge',
  // non-content
  'decorative',
  'background_graphic',
  'other',
] as const

export type PostElementRole = (typeof POST_ELEMENT_ROLES)[number]

export const isPostElementRole = (v: unknown): v is PostElementRole => typeof v === 'string' && (POST_ELEMENT_ROLES as readonly string[]).includes(v)
