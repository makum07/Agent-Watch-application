export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertCategory =
  | 'bottleneck'
  | 'loop'
  | 'duplicate-work'
  | 'excessive-tools'
  | 'context-bloat'
  | 'long-chain';

export interface DebugAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  agentIds: string[];
  metric?: number;
  threshold?: number;
}

export interface SessionAnalytics {
  summary: {
    totalAgents: number;
    totalTokens: number;
    totalToolCalls: number;
    totalCost: number;
    wallClock: number;
    agentTime: number;
    parallelismFactor: number;
    avgTokensPerAgent: number;
    avgDurationPerAgent: number;
    avgToolCallsPerAgent: number;
    cacheEfficiency: number;
  };
  costBreakdown: {
    byModel: Array<{ model: string; cost: number; tokens: number; agentCount: number }>;
    byAgent: Array<{ agentId: string; name: string; cost: number; tokens: number; durationMs: number }>;
    byPhase: Array<{ phase: string; cost: number; tokens: number; agentCount: number; agentIds: string[] }>;
  };
  criticalPath: Array<{ agentId: string; name: string; durationMs: number; depth: number }>;
  alerts: DebugAlert[];
}

export interface SessionComparisonData {
  sessionA: SessionAnalytics & { id: string; project: string; created: string };
  sessionB: SessionAnalytics & { id: string; project: string; created: string };
  deltas: {
    costDelta: number;
    tokenDelta: number;
    durationDelta: number;
    agentCountDelta: number;
  };
}

export interface CrossSessionPattern {
  patternType: 'common-tool-sequence' | 'recurring-agent-topology' | 'cost-outlier' | 'performance-regression';
  description: string;
  sessionIds: string[];
  confidence: number;
  details: Record<string, unknown>;
}

// ── Enhanced Analytics Types ──────────────────────────────────────────

export type AgentOutcome = 'success' | 'partial_success' | 'failed' | 'running' | 'unknown';

export interface AgentReportCard {
  agentId: string;
  agentName: string;
  agentType: string;
  subagentType: string | null;
  parentId: string | null;
  depth: number;
  task: string | null;
  taskFull: string | null;
  outcome: AgentOutcome;
  outcomeReason: string;
  responsePreview: string | null;
  errorToolCount: number;
  deniedToolCount: number;
  totalToolCalls: number;
  toolCallBreakdown: { name: string; count: number }[];
  durationMs: number;
  durationVsMedianRatio: number;
  tokenEfficiency: number;
  cost: number;
  childCount: number;
  childSuccessCount: number;
  childFailureCount: number;
  childPartialCount: number;
  skillsUsed: string[];
  issues: AgentIssue[];
}

export type IssueCategory =
  | 'error_handling'
  | 'permission_denial'
  | 'retry_loop'
  | 'unfocused_exploration'
  | 'context_bloat'
  | 'slow_execution'
  | 'delegation_failure'
  | 'empty_result'
  | 'deep_nesting'
  | 'duplicate_work'
  | 'model_mismatch'
  | 'no_tool_usage'
  | 'excessive_output';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface AgentIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  explanation: string;
  rootCause: string;
  agentIds: string[];
  metric?: number;
  recommendation: string;
}

export interface DelegationDetail {
  childAgentId: string;
  childName: string;
  childType: string | null;
  promptLength: number;
  promptQuality: 'detailed' | 'adequate' | 'sparse' | 'none';
  promptQualityReason: string;
  agentTypeMatch: 'appropriate' | 'questionable' | 'unknown';
  agentTypeMatchReason: string;
  childOutcome: AgentOutcome;
  childCost: number;
  childDurationMs: number;
  issues: string[];
}

export interface DelegationAssessment {
  orchestratorId: string;
  orchestratorName: string;
  totalDelegations: number;
  successfulDelegations: number;
  failedDelegations: number;
  delegations: DelegationDetail[];
  overallScore: 'good' | 'needs_improvement' | 'poor';
  overallNotes: string[];
}

export interface ExecutionPhase {
  phaseNumber: number;
  label: string;
  description: string;
  agents: string[];
  startTime: string;
  endTime: string;
  durationMs: number;
  cost: number;
  outcomeDescription: string;
}

export interface ExecutionNarrative {
  summary: string;
  phases: ExecutionPhase[];
  outcome: string;
}

export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationTarget = 'orchestrator' | 'agent_type' | 'skill' | 'permissions' | 'architecture';

export interface ImprovementRecommendation {
  id: string;
  priority: RecommendationPriority;
  target: RecommendationTarget;
  targetName: string;
  title: string;
  problem: string;
  recommendation: string;
  evidence: string[];
  relatedAgentIds: string[];
}

export interface EnhancedSummary {
  totalAgents: number;
  totalTokens: number;
  totalToolCalls: number;
  totalCost: number;
  wallClock: number;
  agentTime: number;
  parallelismFactor: number;
  avgTokensPerAgent: number;
  avgDurationPerAgent: number;
  avgToolCallsPerAgent: number;
  cacheEfficiency: number;
  successRate: number;
  errorRate: number;
  denialRate: number;
  modelsUsed: string[];
  maxDepth: number;
  orchestratorCount: number;
  leafAgentCount: number;
}

export interface EnhancedSessionAnalytics extends SessionAnalytics {
  enhancedSummary: EnhancedSummary;
  executionNarrative: ExecutionNarrative;
  agentReportCards: AgentReportCard[];
  issues: AgentIssue[];
  delegationAssessments: DelegationAssessment[];
  recommendations: ImprovementRecommendation[];
  copyableAnalysis: string;
}

// ── Execution Facts (evidence-based, no generated opinions) ──────────

export interface AgentFacts {
  agentId: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  type: string;
  subagentType: string | null;
  model: string;
  status: string;
  depth: number;
  startTime: string;
  endTime: string | null;
  durationMs: number;

  tokenUsage: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
  estimatedCost: number;
  messageCount: number;

  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  deniedToolCalls: number;
  toolBreakdown: { name: string; count: number }[];

  childrenIds: string[];
  childrenCount: number;
  promptLength: number;
  responseLength: number;

  skillInvocations: { skill: string; args: string | null; durationMs: number | null }[];
}

export interface AgentTypeGroup {
  type: string;
  agents: AgentFacts[];
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
  agentCount: number;
}

export interface ExecutionFacts {
  summary: {
    totalAgents: number;
    totalTokens: number;
    totalToolCalls: number;
    totalCost: number;
    wallClock: number;
    agentTime: number;
    parallelismFactor: number;
    cacheEfficiency: number;
    modelsUsed: string[];
    maxDepth: number;
    totalFailedToolCalls: number;
    totalDeniedToolCalls: number;
  };

  orchestrator: AgentFacts | null;
  agentFacts: AgentFacts[];
  agentTypeGroups: AgentTypeGroup[];

  costBreakdown: {
    byModel: Array<{ model: string; cost: number; tokens: number; agentCount: number }>;
    byAgent: Array<{ agentId: string; name: string; cost: number; tokens: number; durationMs: number }>;
  };

  criticalPath: Array<{ agentId: string; name: string; durationMs: number; depth: number }>;

  timeline: Array<{
    agentId: string;
    name: string;
    type: string;
    subagentType: string | null;
    startTime: string;
    endTime: string | null;
    durationMs: number;
    depth: number;
    parentId: string | null;
  }>;

  failedToolCategories: Array<{
    category: string;
    count: number;
    agentIds: string[];
  }>;
}

// ── Tool Timeline Types ──────────────────────────────────────────────

export interface ToolTimelineEntry {
  id: string;
  index: number;
  name: string;
  inputSummary: string;
  resultPreview: string;
  isError: boolean;
  durationMs: number | null;
  isAgentSpawn: boolean;
  childAgentId: string | null;
}

// ── AI Analysis Types ─────────────────────────────────────────────────

// The model's response is free-form JSON, not a validated schema — any
// field can arrive missing, and in practice the model sometimes drifts to
// different field names entirely for the same concept. `target`/`finding`
// are alternates seen in the wild for `title`/`observation`; the renderer
// falls back across both rather than assuming the requested shape held.
export interface ExecutionFinding {
  severity?: 'critical' | 'high' | 'medium' | 'low';
  title?: string;
  category?: string;
  agentId?: string;
  observation?: string;
  rootCause?: string;
  recommendation?: string;
  /** String on older stored cycles (pre-array-evidence prompt); array going forward. */
  evidence?: string | string[];
  confidence?: 'high' | 'medium' | 'low';
  target?: string;
  finding?: string;
  /** Ready-to-paste feedback text for `agentId`'s feedback log — set only when the finding traces to one specific agent. */
  feedbackText?: string;
  /** Closest match from `FeedbackCategory` (types/feedback.ts) — free-form model output, not guaranteed to be a valid value. */
  feedbackCategory?: string;
}

// Raised when an agent complied with its definition (no `ExecutionFinding`
// finding) but its actual deliverable still fell short of what the task
// needed — judged against evidence the agent itself had access to, not
// against the definition's checklist. Compliance and outcome quality are
// different questions; this covers the second one.
export interface ExecutionOutcomeFinding {
  agentId?: string;
  title?: string;
  whatWasExpected?: string;
  whatWasProduced?: string;
  gap?: string;
  evidence?: string[];
  confidence?: 'high' | 'medium' | 'low';
  /** Ready-to-paste feedback text for `agentId`'s feedback log — set only when the finding traces to one specific agent. */
  feedbackText?: string;
  /** Closest match from `FeedbackCategory` (types/feedback.ts) — free-form model output, not guaranteed to be a valid value. */
  feedbackCategory?: string;
}

// Raised for an agent that fully complied with its definition and produced
// an adequate result — no `ExecutionFinding`, no
// `ExecutionOutcomeFinding` gap — but the session transcript shows a
// specific way the definition itself could be strengthened so future runs
// do even better. Orthogonal to the other two: this fires on a definition
// that worked but could ask for more.
export interface ExecutionEnhancementOpportunity {
  agentId?: string;
  title?: string;
  currentInstruction?: string;
  observation?: string;
  suggestedEnhancement?: string;
  expectedBenefit?: string;
  evidence?: string[];
  confidence?: 'high' | 'medium' | 'low';
  /** Ready-to-paste feedback text for `agentId`'s feedback log — set only when the opportunity traces to one specific agent. */
  feedbackText?: string;
  /** Closest match from `FeedbackCategory` (types/feedback.ts) — free-form model output, not guaranteed to be a valid value. */
  feedbackCategory?: string;
}

export interface ExecutionAnalysisCycle {
  id: string;
  sessionId: string;
  cycleNumber: number;
  analysisPrompt: string;
  analysisResponse: string | null;
  executionFindings: ExecutionFinding[] | null;
  outcomeFindings: ExecutionOutcomeFinding[] | null;
  enhancementOpportunities: ExecutionEnhancementOpportunity[] | null;
  status: 'pending' | 'analyzing' | 'completed' | 'failed' | 'cancelled';
  streamEntries: import('@/types/feedback').StreamEntry[] | null;
  /** Model the CLI actually reported running (from its init stream-json event), not just what was requested. */
  model: string | null;
  /** The new one-shot CLI session's own id — unlike the improvement loop, this always starts a fresh session rather than resuming one. Resumable via `claude --resume <id>`. */
  cliSessionId: string | null;
  createdAt: string;
  completedAt: string | null;
}
