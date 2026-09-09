import type { Agent } from '@/types/session';

// AI-generated recommendations echo an agent id back from the analysis
// prompt, but the model doesn't always copy the full hex string verbatim —
// it can truncate or paraphrase it. Fall back to a prefix match against the
// real ids before giving up, so a mangled id still resolves to the right
// agent instead of rendering as a raw hex fragment.
export function resolveAgentById(agentMap: Map<string, Agent>, id: string | null | undefined): Agent | undefined {
  if (!id) return undefined;
  const exact = agentMap.get(id);
  if (exact) return exact;
  if (id.length < 6) return undefined;
  for (const agent of agentMap.values()) {
    if (agent.id.startsWith(id)) return agent;
  }
  return undefined;
}

// Named agent types with fixed colors
const NAMED_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Orchestrator: { bg: 'var(--aw-phase-blue)',       text: 'var(--aw-blue)',              border: 'var(--aw-blue-bg)' },
  Explore:      { bg: 'var(--aw-green-bg)',          text: 'var(--aw-green)',             border: 'var(--aw-green-bg-2)' },
  Plan:         { bg: 'var(--aw-phase-orange)',      text: 'var(--aw-orange)',            border: 'var(--aw-orange-bg)' },
  'general-purpose': { bg: 'var(--aw-purple-bg-deep2)', text: 'var(--aw-purple)',        border: 'var(--aw-purple-border)' },
  'code-reviewer':   { bg: 'var(--aw-code-reviewer-bg)', text: 'var(--aw-red)',          border: 'var(--aw-code-reviewer-border)' },
  Workflow:     { bg: 'var(--aw-green-bg)',          text: 'var(--aw-green-bright)',      border: 'var(--aw-green-bg-2)' },
};

// Palette for dynamically-labeled agents (workflow subagents with free-form labels)
const PALETTE = [
  { bg: 'var(--aw-phase-blue)',      text: 'var(--aw-blue)',         border: 'var(--aw-blue-bg)' },       // blue
  { bg: 'var(--aw-green-bg)',        text: 'var(--aw-green-bright)', border: 'var(--aw-green-bg-2)' },    // teal-green
  { bg: 'var(--aw-phase-orange)',    text: 'var(--aw-orange)',       border: 'var(--aw-orange-bg)' },      // orange
  { bg: 'var(--aw-purple-bg-deep2)', text: 'var(--aw-purple)',       border: 'var(--aw-purple-border)' }, // purple
  { bg: 'var(--aw-salmon-bg)',       text: 'var(--aw-red-light)',    border: 'var(--aw-salmon-border)' }, // salmon
  { bg: 'var(--aw-teal-bg)',         text: 'var(--aw-cyan)',         border: 'var(--aw-teal-border)' },   // cyan
  { bg: 'var(--aw-amber-bg)',        text: 'var(--aw-amber)',        border: 'var(--aw-amber-border)' },  // amber
  { bg: 'var(--aw-lime-bg)',         text: 'var(--aw-lime)',         border: 'var(--aw-lime-border)' },   // lime
];

/** Simple stable hash to pick a palette color for a given label */
function hashLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = ((h << 5) - h) + label.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % PALETTE.length;
}

/** Format a kebab-case OR space-separated label to a clean display name */
export function formatAgentLabel(raw: string): string {
  if (!raw) return '';

  // If it already has spaces, it's a natural-language description — capitalize first letter only
  if (raw.includes(' ')) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Kebab/snake case → Title Case (e.g. "session-format-researcher" → "Session Format Researcher")
  return raw
    .split(/[-_]+/)
    .map(word => {
      if (['api', 'ui', 'db', 'aws', 'llm', 'ai', 'ac'].includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Built-in / framework agent types. Anything with a subagentType NOT in this
 * set (and not the workflow-subagent sentinel) is a project/custom agent whose
 * own name IS its identity (e.g. "gtc-application-context").
 */
const BUILTIN_TYPES = new Set([
  'Explore', 'Plan', 'general-purpose', 'code-reviewer',
  'claude', 'claude-code-guide', 'statusline-setup',
]);

/** What class of agent this is — drives badge styling so a gtc-* agent never
 *  reads as a generic "Workflow Subagent". */
export type AgentKind = 'orchestrator' | 'builtin' | 'general-purpose' | 'project' | 'workflow' | 'unknown';

export interface AgentDisplay {
  name: string;            // Primary display name
  shortName: string;       // Abbreviated (max ~16 chars)
  typeLabel: string;       // Secondary type hint ("Project agent", "Orchestrator", etc.)
  kind: AgentKind;         // Resolved class — distinguishes project/custom vs workflow vs built-in
  agentName: string | null;// Resolved agent identity (subagent_type) when known
  color: { bg: string; text: string; border: string };
  initials: string;        // 1–2 letter initials for avatars/compact views
}

// ─── Status display ──────────────────────────────────────────────────────
// "Came to rest" is not the same as "succeeded cleanly". Green is reserved for
// clean success; agents with denied or failed tool calls render amber/red.

export type StatusTone = 'ok' | 'warn' | 'danger' | 'running' | 'idle';

export const STATUS_TONE_HEX: Record<StatusTone, string> = {
  ok:      '#3fb950',
  warn:    '#d29922',
  danger:  '#f85149',
  running: '#58a6ff',
  idle:    '#8b949e',
};

export interface StatusDisplay {
  label: string;
  tone: StatusTone;
  hex: string;
  title: string;
}

export function getStatusDisplay(
  agent: Pick<Agent, 'status' | 'errorToolCount' | 'deniedToolCount'>
): StatusDisplay {
  const denied = agent.deniedToolCount ?? 0;
  const errors = agent.errorToolCount ?? 0;
  const detail = [
    denied > 0 ? `${denied} denied tool call${denied !== 1 ? 's' : ''}` : null,
    errors - denied > 0 ? `${errors - denied} failed tool call${errors - denied !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  switch (agent.status) {
    case 'running':
      return { label: 'running', tone: 'running', hex: STATUS_TONE_HEX.running, title: 'Still running' };
    case 'errored':
      return { label: 'errored', tone: 'danger', hex: STATUS_TONE_HEX.danger, title: 'Agent errored' };
    case 'completed_with_errors': {
      // Denials are the most serious signal (deliverable may not have been produced).
      if (denied > 0) {
        return {
          label: `${denied} denied`,
          tone: 'danger',
          hex: STATUS_TONE_HEX.danger,
          title: `Completed, but ${detail}`,
        };
      }
      return {
        label: `${errors} error${errors !== 1 ? 's' : ''}`,
        tone: 'warn',
        hex: STATUS_TONE_HEX.warn,
        title: `Completed with errors — ${detail}`,
      };
    }
    case 'completed':
      return { label: 'completed', tone: 'ok', hex: STATUS_TONE_HEX.ok, title: 'Completed cleanly' };
    default:
      return { label: agent.status || 'unknown', tone: 'idle', hex: STATUS_TONE_HEX.idle, title: 'Unknown status' };
  }
}

export function getAgentDisplay(agent: Agent): AgentDisplay {
  const desc = agent.description; // task description from parent ("Fetch ZER-9055…")
  const subType = agent.subagentType; // resolved agent type ("gtc-task-context", "Explore", "workflow-subagent")
  const agentType = agent.type; // "orchestrator", "subagent", "workflow"

  // 1. Orchestrator
  if (agentType === 'orchestrator') {
    return {
      name: 'Orchestrator',
      shortName: 'Orchestrator',
      typeLabel: 'Main',
      kind: 'orchestrator',
      agentName: null,
      color: NAMED_TYPE_COLORS['Orchestrator'],
      initials: 'OR',
    };
  }

  // 2. Workflow subagents — these genuinely ARE workflow subagents; the label
  //    (description) is the meaningful identity. Detect by type or sentinel.
  if (agentType === 'workflow' || subType === 'workflow-subagent') {
    const formatted = desc ? formatAgentLabel(desc) : 'Workflow Subagent';
    const colorIdx = hashLabel(desc || 'workflow');
    const color = PALETTE[colorIdx];
    const words = formatted.split(' ');
    const initials = words.length >= 2 ? words[0][0] + words[1][0] : formatted.slice(0, 2);
    return {
      name: formatted,
      shortName: formatted.slice(0, 18),
      typeLabel: 'Workflow subagent',
      kind: 'workflow',
      agentName: null,
      color,
      initials: initials.toUpperCase(),
    };
  }

  // 3. Built-in named types (Explore, Plan, general-purpose, code-reviewer, …)
  if (subType && BUILTIN_TYPES.has(subType)) {
    const color = NAMED_TYPE_COLORS[subType] ?? PALETTE[hashLabel(subType)];
    const shortDesc = desc ? formatAgentLabel(desc) : '';
    const name = shortDesc ? `${subType}: ${shortDesc}` : subType;
    const shortName = subType + (shortDesc ? `: ${shortDesc.slice(0, 20)}` : '');
    const initials = subType === 'general-purpose' ? 'GP' : subType.slice(0, 2).toUpperCase();
    return {
      name,
      shortName: shortName.slice(0, 28),
      typeLabel: subType,
      kind: subType === 'general-purpose' ? 'general-purpose' : 'builtin',
      agentName: subType,
      color,
      initials,
    };
  }

  // 4. Project / custom agent — its subagent_type IS its identity. This is the
  //    case the old code mislabeled as "Workflow Subagent". Show the agent
  //    name primarily; the task description is secondary (rendered elsewhere).
  if (subType) {
    const color = PALETTE[hashLabel(subType)];
    const words = formatAgentLabel(subType).split(' ');
    const initials = words.length >= 2 ? words[0][0] + words[1][0] : subType.slice(0, 2);
    return {
      name: subType,
      shortName: subType.length > 24 ? subType.slice(0, 23) + '…' : subType,
      typeLabel: 'Project agent',
      kind: 'project',
      agentName: subType,
      color,
      initials: initials.toUpperCase(),
    };
  }

  // 5. No subagent_type at all — fall back to the description label.
  if (desc) {
    const formatted = formatAgentLabel(desc);
    const colorIdx = hashLabel(desc);
    const color = PALETTE[colorIdx];
    const words = formatted.split(' ');
    const initials = words.length >= 2 ? words[0][0] + words[1][0] : formatted.slice(0, 2);
    return {
      name: formatted,
      shortName: formatted.slice(0, 18),
      typeLabel: 'Subagent',
      kind: 'unknown',
      agentName: null,
      color,
      initials: initials.toUpperCase(),
    };
  }

  // 6. Last-resort fallback
  const fallback = formatAgentLabel(subType || agentType || 'Agent');
  const colorIdx = hashLabel(fallback);
  return {
    name: fallback,
    shortName: fallback.slice(0, 18),
    typeLabel: agentType,
    kind: 'unknown',
    agentName: null,
    color: PALETTE[colorIdx],
    initials: fallback.slice(0, 2).toUpperCase(),
  };
}
