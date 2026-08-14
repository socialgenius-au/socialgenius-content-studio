// ── Unified Growth & Positioning Platform — domain types ──────────────────────
// These are frontend contracts for modules with no backend yet (positioning,
// intelligence, audit, strategy, campaigns, leads, ops, entitlements,
// knowledge, analytics). Shapes are intentionally close to what a real API
// would return so services/*.ts can be swapped from mock to live without
// touching components. See services/README for the integration contract.

export type EvidenceType = 'fact' | 'inference' | 'hypothesis'
export type Confidence = 'low' | 'medium' | 'high'
export type ClassificationCIA = 'control' | 'influence' | 'adapt'

// ── Client ──────────────────────────────────────────────────────────────────

export interface ClientGoal {
  id: string
  label: string
}

export interface Client {
  id: string
  name: string
  industry: string
  location: string
  logoInitial: string
  color: string
  contact: { name: string; email: string; phone: string }
  goals: string[]
  targetCustomers: string
  capabilitiesSummary: string
  constraintsSummary: string
  servicePlanId: string
  activeCampaignId: string | null
  positioningStatus: 'not_started' | 'draft' | 'pending_approval' | 'approved'
  positioningConfidence: number // 0-100, AI assessment
  positioningAlignment: number // 0-100
  strategicPriority: string
}

// ── Positioning ─────────────────────────────────────────────────────────────

export interface PositioningFramework {
  id: string
  name: string
  version: string
  status: 'active' | 'draft' | 'deprecated' | 'experimental'
  createdAt: string
  changeSummary: string
  applicableIndustries: string[]
}

export interface DDDSScore {
  desirability: number
  differentiation: number
  deliverability: number
  sustainability: number
  note: string
}

export interface PositioningProfile {
  clientId: string
  frameworkId: string
  currentPosition: string
  targetPosition: string
  desiredPerception: string
  targetCustomer: string
  categoryExpectations: string[]
  competitorPositions: { name: string; position: string }[]
  differentiators: string[]
  proofPoints: string[]
  capabilities: string[]
  constraints: string[]
  promise: string
  reasonsToBelieve: string[]
  positioningStatement: string
  messagingPillars: string[]
  approvedClaims: string[]
  claimsNotYetDeliverable: string[]
  scores: DDDSScore
  approvalStatus: 'draft' | 'pending_approval' | 'approved_with_conditions' | 'approved' | 'changes_requested'
  approvalHistory: { date: string; actor: string; action: string; note?: string }[]
  frameworkChangeLog: { date: string; from: string; to: string; reason: string }[]
}

export interface FrameworkComparison {
  frameworkA: { id: string; name: string; version: string }
  frameworkB: { id: string; name: string; version: string }
  agreements: string[]
  disagreements: string[]
  scoreDeltas: { desirability: number; differentiation: number; deliverability: number; sustainability: number }
  recommendation: string
}

export interface CapabilityMapItem {
  id: string
  area: 'People' | 'Skills' | 'Processes' | 'Product/Service' | 'Technology' | 'Capacity' | 'Customer Service' | 'Pricing/Economics' | 'Proof' | 'Management Commitment'
  status: 'ready' | 'needs_improvement' | 'not_deliverable'
  note: string
}

export interface ExperienceStage {
  stage: 'Discover' | 'Research' | 'Enquire' | 'Compare' | 'Visit/Consult' | 'Buy' | 'Receive' | 'Use' | 'Support' | 'Review' | 'Refer'
  promisedExperience: string
  currentReality: string
  evidence: string
  gap: 'none' | 'minor' | 'major'
  requiredAction: string
}

// ── Strategic Intelligence ─────────────────────────────────────────────────

export type IntelligenceArea =
  | 'Macro & Economic' | 'Industry' | 'Technology & Disruption' | 'Customer & Demand'
  | 'Competitive Intelligence' | 'Business Intelligence' | 'Government / Local Environment'
  | 'Signals / Opportunities / Risks'

export interface IntelligenceFinding {
  id: string
  area: IntelligenceArea
  title: string
  detail: string
  source: string
  date: string
  confidence: Confidence
  evidenceType: EvidenceType
  refreshDate: string
  classification: ClassificationCIA
}

// ── Social Audit ────────────────────────────────────────────────────────────

export interface AuditDimension {
  id: string
  name: string
  currentScore: number // 0-100
  strategicImportance: 'low' | 'medium' | 'high'
  gap: string
  evidence: string
  recommendedAction: string
  impact: 'low' | 'medium' | 'high'
  owner: string
  timeline: string
}

// ── Strategy & Roadmap ──────────────────────────────────────────────────────

export interface StrategicInitiative {
  id: string
  objective: string
  whyItMatters: string
  supportingIntelligenceIds: string[]
  positioningRelationship: string
  actions: string[]
  responsiblePerson: string
  targetDate: string
  kpi: string
  status: 'not_started' | 'in_progress' | 'at_risk' | 'done'
  classification: ClassificationCIA
  horizon: 30 | 60 | 90
}

// ── Campaigns ────────────────────────────────────────────────────────────

export type ContentAssetType = 'video' | 'reel' | 'post' | 'carousel' | 'blog' | 'pr' | 'email' | 'whatsapp' | 'gbp' | 'ad' | 'landing_page'

export interface CampaignAsset {
  id: string
  type: ContentAssetType
  title: string
  status: 'draft' | 'review' | 'approved' | 'scheduled' | 'published'
}

export interface Campaign {
  id: string
  clientId: string
  name: string
  objective: string
  audience: string
  positioningObjective: string
  coreMessage: string
  customerProblem: string
  desiredOutcome: string
  proof: string
  offer: string
  cta: string
  duration: string
  platforms: string[]
  strategicInitiativeId: string | null
  successMeasure: string
  status: 'planning' | 'active' | 'paused' | 'complete'
  assets: CampaignAsset[]
  leadsGenerated: number
}

// ── Create Hub / AI creative decisions ─────────────────────────────────────

export type CreativeOutcome = 'Attention' | 'Reach' | 'Trust' | 'Authority' | 'Education' | 'Differentiation' | 'Enquiry' | 'Booking' | 'Sale' | 'Offer promotion' | 'Belief change' | 'Reputation' | 'Referral'

export interface CreativeOption {
  id: string
  label: string
  pitch: string
  attentionScore: number
  positioningScore: number
  outcomeScore: number
  why: string
  perceptionCreated: string
  proofRequired: string
  risk: string
}

export type GateResult = 'green' | 'amber' | 'red'

export interface PositioningGateCheck {
  result: GateResult
  reason: string
  corrections: string[]
}

// ── Publishing / platform versions ─────────────────────────────────────────

export interface PlatformVersion {
  id: string
  platform: string
  title: string
  caption: string
  hashtags: string
  cta: string
  locked: Record<string, boolean>
  status: 'draft' | 'review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed'
  scheduledFor: string | null
}

// ── Connections ─────────────────────────────────────────────────────────

export interface PlatformConnection {
  id: string
  platform: string
  status: 'connected' | 'disconnected' | 'warning'
  accountName: string | null
  permissions: string[]
  lastSynced: string | null
}

// ── Leads & Sales ────────────────────────────────────────────────────────

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'opportunity' | 'appointment_quote' | 'won' | 'lost'

export interface Lead {
  id: string
  clientId: string
  name: string
  source: string
  campaignId: string | null
  contentId: string | null
  platform: string
  positioningTheme: string
  owner: string
  value: number
  stage: LeadStage
  outcome: string | null
  createdAt: string
}

// ── Inbox & Nurture ─────────────────────────────────────────────────────

export type AutomationLevel = 'L1_ack' | 'L2_info' | 'L3_qualify' | 'L4_nurture' | 'L5_human'

export interface Conversation {
  id: string
  clientId: string
  channel: 'whatsapp' | 'email' | 'social' | 'website'
  contactName: string
  lastMessage: string
  automationLevel: AutomationLevel
  aiConfidence: number
  escalationTrigger: string | null
  lastResponseAt: string
  slaMinutesRemaining: number
  responsibleStaff: string
}

// ── Tasks & Delivery (OpsGenius surface) ────────────────────────────────

export interface OpsTask {
  id: string
  clientId: string
  title: string
  assignee: string
  dueDate: string
  status: 'todo' | 'in_progress' | 'blocked' | 'awaiting_approval' | 'done'
  recurring: boolean
  overdue: boolean
}

// ── Service Configurator / Entitlements ─────────────────────────────────

export type ServiceFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'custom'

export interface ServiceEntitlement {
  key: string
  label: string
  enabled: boolean
  quantity: number
  frequency: ServiceFrequency
  serviceLevel: 'standard' | 'priority' | 'white_glove'
  clientFacing: boolean
  usageLimit: number | null
}

export interface ServicePlan {
  id: string
  name: string
  clientId: string
  entitlements: ServiceEntitlement[]
}

// ── Knowledge & Learning ─────────────────────────────────────────────────

export type KnowledgeScope = 'global' | 'industry' | 'client'
export type KnowledgeType = 'pain_point' | 'expectation' | 'hook' | 'objection' | 'cta' | 'lead_source' | 'positioning_pattern' | 'proof_mechanism' | 'campaign_structure' | 'experience_standard' | 'audit_rule' | 'successful_pattern'

export interface KnowledgeItem {
  id: string
  scope: KnowledgeScope
  type: KnowledgeType
  title: string
  detail: string
  industry: string | null
  audience: string | null
  source: string
  evidence: string
  confidence: Confidence
  date: string
  lastValidated: string
  performanceEvidence: string | null
  status: 'proposed' | 'validated' | 'retired'
}

// ── Analytics ─────────────────────────────────────────────────────────

export interface AnalyticsSnapshot {
  clientId: string
  attention: { views: number; watchTime: string; retention: number; completion: number; engagementRate: number }
  positioning: { alignmentScore: number; drift: string; sentiment: 'positive' | 'neutral' | 'negative'; dominantCustomerLanguage: string[] }
  business: { clicks: number; enquiries: number; qualifiedLeads: number; appointments: number; sales: number; revenue: number | null }
}

// ── Entitlements (capability checks) ────────────────────────────────────

export type EntitlementKey = string // e.g. 'content.reels', 'intelligence.macro', 'leads.whatsapp', 'publish.linkedin'

// ── Role ─────────────────────────────────────────────────────────────

export type StaffRole = 'admin' | 'strategist' | 'content_creator' | 'operations' | 'sales'
