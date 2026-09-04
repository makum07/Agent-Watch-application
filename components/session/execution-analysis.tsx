'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Play, Loader2, ChevronDown, ChevronRight,
  Copy, Check, Trash2, Eye, EyeOff, MessageSquarePlus,
  FileText, MessageSquare, Clock, ListChecks, TrendingUp, Target,
} from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useExecutionAnalysisStore } from '@/store/execution-analysis-store';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { CollapsibleStreamLog } from '@/components/shared/collapsible-stream-log';
import { ModelSelect } from '@/components/shared/model-select';
import { StopButton } from '@/components/shared/stop-button';
import { CopyableSessionId } from '@/components/shared/copyable-session-id';
import {
  MetaChip, CycleSectionHeader, CycleSectionLabel, Field, CalloutField, SEVERITY_COLOR,
} from '@/components/shared/cycle-section';
import type { SessionEvent } from '@/types/events';
import type { ExecutionAnalysisCycle, ExecutionFinding, ExecutionOutcomeFinding, ExecutionEnhancementOpportunity } from '@/types/analytics';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@/types/feedback';
import { resolveAgentById } from '@/lib/agent-display';

interface ExecutionAnalysisProps {
  sessionId: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  analyzing:  { label: 'Analyzing…', color: 'var(--aw-blue)' },
  completed:  { label: 'Completed',  color: 'var(--aw-green)' },
  failed:     { label: 'Failed',     color: 'var(--aw-red-bright)' },
  cancelled:  { label: 'Cancelled',  color: 'var(--aw-text-3)' },
  pending:    { label: 'Pending',    color: 'var(--aw-text-3)' },
};

export function ExecutionAnalysis({ sessionId }: ExecutionAnalysisProps) {
  const {
    cycles, isAnalyzing, isStopping, lastError, streamEntries, model,
    loadCycles, previewPrompt, triggerAnalysis, stopAnalysis, deleteCycle, handleStreamEvent,
    clearError, clearStream, setModel,
  } = useExecutionAnalysisStore();

  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'edit'>('preview');
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);

  useEffect(() => {
    loadCycles(sessionId);
  }, [sessionId, loadCycles]);

  // Poll while analyzing — catches completion if WebSocket drops
  useEffect(() => {
    if (!isAnalyzing) return;
    const interval = setInterval(() => loadCycles(sessionId), 10_000);
    return () => clearInterval(interval);
  }, [isAnalyzing, sessionId, loadCycles]);

  useEffect(() => {
    if (expandedCycleId) return;
    const latest = cycles.find(c => c.status === 'completed' || c.status === 'analyzing');
    if (latest) setExpandedCycleId(latest.id);
  }, [cycles.length]);

  const onWsEvent = useCallback((event: SessionEvent) => {
    if (
      event.type === 'execution_analysis_started' ||
      event.type === 'execution_analysis_stream_event' ||
      event.type === 'execution_analysis_complete' ||
      event.type === 'execution_analysis_failed'
    ) {
      handleStreamEvent(event);
    }
  }, [handleStreamEvent]);

  useWebSocket(onWsEvent);

  const handlePreviewPrompt = async () => {
    if (showPromptPreview && promptText) {
      setShowPromptPreview(false);
      return;
    }
    setLoadingPrompt(true);
    const prompt = await previewPrompt(sessionId);
    setPromptText(prompt);
    setPromptViewMode('preview');
    setShowPromptPreview(true);
    setLoadingPrompt(false);
  };

  const handleRunAnalysis = async (customPrompt?: string) => {
    clearError();
    clearStream();
    const cycle = await triggerAnalysis(sessionId, customPrompt || undefined);
    if (cycle) setExpandedCycleId(cycle.id);
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => handleRunAnalysis(showPromptPreview ? promptText || undefined : undefined)}
          disabled={isAnalyzing}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors',
            isAnalyzing
              ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-3)] cursor-not-allowed'
              : 'bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white'
          )}
        >
          {isAnalyzing
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Analyzing...</>
            : <><Sparkles className="h-3 w-3" /> Run AI Analysis</>
          }
        </button>
        <ModelSelect value={model} onChange={setModel} disabled={isAnalyzing} />
        {isAnalyzing && (
          <StopButton onClick={() => stopAnalysis(sessionId)} stopping={isStopping} />
        )}
        <button
          onClick={handlePreviewPrompt}
          disabled={loadingPrompt}
          className="flex items-center gap-1 px-2 py-2 rounded-md text-[10px] text-[var(--aw-text-2)] hover:text-[var(--aw-text-1)] transition-colors border border-[var(--aw-bg-3)] hover:border-[var(--aw-text-4)]"
        >
          {loadingPrompt
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : showPromptPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />
          }
          {showPromptPreview ? 'Hide Prompt' : 'Preview Prompt'}
        </button>
      </div>

      {lastError && (
        <div className="p-3 rounded-md border border-[var(--aw-red)]/30 bg-[var(--aw-red)]/10 text-xs text-[var(--aw-red)]">
          {lastError}
          <button onClick={clearError} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Prompt Preview */}
      {showPromptPreview && promptText && (
        <div className="rounded-md border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)]">
            <span className="text-[10px] text-[var(--aw-text-2)] flex-1">Analysis Prompt</span>
            <div className="flex items-center shrink-0 rounded border border-[var(--aw-bg-3)] overflow-hidden text-[10px]">
              <button
                onClick={() => setPromptViewMode('preview')}
                className={cn(
                  'px-2 py-0.5 transition-colors',
                  promptViewMode === 'preview'
                    ? 'bg-[var(--aw-blue)] text-white'
                    : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]',
                )}
              >
                Preview
              </button>
              <button
                onClick={() => setPromptViewMode('edit')}
                className={cn(
                  'px-2 py-0.5 transition-colors border-l border-[var(--aw-bg-3)]',
                  promptViewMode === 'edit'
                    ? 'bg-[var(--aw-blue)] text-white'
                    : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]',
                )}
              >
                Edit
              </button>
            </div>
            <span className="text-[10px] text-[var(--aw-text-4)] font-mono tabular-nums shrink-0">
              {promptText.length.toLocaleString()} chars
            </span>
            <button
              onClick={() => handleRunAnalysis(promptText)}
              disabled={isAnalyzing}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-50 shrink-0"
            >
              <Play className="h-2.5 w-2.5" /> Run
            </button>
          </div>
          {promptViewMode === 'preview' ? (
            <div className="px-4 py-3 overflow-y-auto max-h-[500px]">
              <MarkdownRenderer content={promptText} size="sm" />
            </div>
          ) : (
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              className="w-full p-3 bg-transparent text-[10px] text-[var(--aw-text-1)] font-mono resize-y min-h-[200px] max-h-[500px] outline-none"
              rows={15}
            />
          )}
        </div>
      )}

      {/* Analysis Cycles */}
      {(cycles.length > 0 || isAnalyzing) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] text-[var(--aw-text-2)] uppercase tracking-wide">Analysis History</h4>
            {cycles.length > 0 && (
              <span className="text-[10px] text-[var(--aw-text-4)]">
                {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {cycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              sessionId={sessionId}
              isExpanded={expandedCycleId === cycle.id}
              onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
              onDelete={() => deleteCycle(sessionId, cycle.id)}
              liveStreamEntries={cycle.status === 'analyzing' ? streamEntries : []}
              isLive={cycle.status === 'analyzing' && isAnalyzing}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cycle Card ────────────────────────────────────────────────────────────

function CycleCard({
  cycle, sessionId, isExpanded, onToggle, onDelete, liveStreamEntries, isLive,
}: {
  cycle: ExecutionAnalysisCycle;
  sessionId: string;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  liveStreamEntries: import('@/types/feedback').StreamEntry[];
  isLive: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showStream, setShowStream] = useState(isLive);

  useEffect(() => {
    if (isLive) setShowStream(true);
  }, [isLive]);

  const s = STATUS_META[cycle.status] ?? STATUS_META.pending;

  const handleCopy = async () => {
    if (cycle.analysisResponse) {
      await navigator.clipboard.writeText(cycle.analysisResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const hasStreamLog = (cycle.streamEntries && cycle.streamEntries.length > 0) || isLive;
  const streamLabel = isLive ? 'Live Stream' : hasStreamLog ? 'Activity Log' : 'Response';
  const entryCount = isLive
    ? liveStreamEntries.length
    : cycle.streamEntries?.length ?? 0;

  // At-a-glance stats so the collapsed row is informative on its own —
  // you shouldn't have to expand a cycle just to see what it found.
  const recCount = cycle.executionFindings?.length ?? 0;
  const outcomeCount = cycle.outcomeFindings?.length ?? 0;
  const enhCount = cycle.enhancementOpportunities?.length ?? 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of cycle.executionFindings ?? []) {
    const sev = r.severity ?? 'medium';
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }
  const durationMs = cycle.completedAt
    ? new Date(cycle.completedAt).getTime() - new Date(cycle.createdAt).getTime()
    : null;

  return (
    <div
      className={cn(
        'rounded border overflow-hidden transition-colors',
        cycle.status === 'analyzing'
          ? 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] ring-1 ring-[var(--aw-blue)]/20'
          : 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]',
      )}
    >
      {/* Header — actions reveal on hover instead of a permanent extra row */}
      <div
        className="group cursor-pointer hover:bg-[var(--aw-bg-2)]/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="text-[11px] font-bold text-[var(--aw-text-0)] shrink-0">#{cycle.cycleNumber}</span>

          <Sparkles className="h-3 w-3 text-[var(--aw-purple)] shrink-0" />

          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{ color: s.color, background: `${s.color}18` }}
          >
            {s.label}
          </span>

          {cycle.model && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] shrink-0"
              title="Model the CLI actually ran with"
            >
              {cycle.model}
            </span>
          )}

          {cycle.cliSessionId && <CopyableSessionId sessionId={cycle.cliSessionId} />}

          <span className="flex-1" />

          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            {cycle.analysisResponse && (
              <button
                onClick={e => { e.stopPropagation(); handleCopy(); }}
                className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
                title="Copy response"
              >
                {copied ? <Check className="h-3 w-3 text-[var(--aw-green)]" /> : <Copy className="h-3 w-3" />}
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-red-bright)] hover:bg-[var(--aw-red-bright)]/10 transition-colors"
              title="Delete this cycle"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>

          <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{date}</span>

          {isExpanded
            ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
            : <ChevronRight className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
          }
        </div>

        {/* Meta strip — glanceable summary without expanding */}
        <div className="flex items-center gap-3 px-3 pb-2 pt-1 text-[10px] text-[var(--aw-text-3)]">
          {recCount > 0 ? (
            <>
              <MetaChip icon={<ListChecks />}>{recCount} execution finding{recCount !== 1 ? 's' : ''}</MetaChip>
              {(['critical', 'high', 'medium', 'low'] as const).filter(sev => severityCounts[sev] > 0).map(sev => (
                <span key={sev} className="font-mono shrink-0" style={{ color: SEVERITY_COLOR[sev] }}>
                  {severityCounts[sev]} {sev}
                </span>
              ))}
            </>
          ) : cycle.status === 'completed' ? (
            <MetaChip icon={<ListChecks />}>No execution findings</MetaChip>
          ) : null}
          {outcomeCount > 0 && (
            <MetaChip icon={<Target />}>{outcomeCount} outcome finding{outcomeCount !== 1 ? 's' : ''}</MetaChip>
          )}
          {enhCount > 0 && (
            <MetaChip icon={<TrendingUp />}>{enhCount} enhancement{enhCount !== 1 ? 's' : ''}</MetaChip>
          )}
          {entryCount > 0 && (
            <MetaChip icon={<MessageSquare />}>{entryCount} event{entryCount !== 1 ? 's' : ''}</MetaChip>
          )}
          {durationMs !== null && durationMs > 0 && (
            <MetaChip icon={<Clock />}>{formatDuration(durationMs)}</MetaChip>
          )}
        </div>
      </div>

      {/* Expanded content — one consistent section shape throughout */}
      {isExpanded && (
        <div className="border-t border-[var(--aw-bg-2)] divide-y divide-[var(--aw-bg-2)]">
          <div>
            <CycleSectionHeader
              icon={<FileText />}
              label="Analysis Prompt"
              open={showPrompt}
              onToggle={() => setShowPrompt(v => !v)}
              trailing={`${cycle.analysisPrompt.length.toLocaleString()} chars`}
            />
            {showPrompt && (
              <div className="px-3 pb-3 bg-[var(--aw-bg-0)]/40">
                <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap max-h-40 overflow-y-auto font-mono bg-[var(--aw-bg-0)] p-2.5 rounded border border-[var(--aw-bg-2)] leading-relaxed">
                  {cycle.analysisPrompt}
                </pre>
              </div>
            )}
          </div>

          {/* Stream / Response log */}
          <div>
            <CycleSectionHeader
              icon={isLive ? <Loader2 className="animate-spin" /> : <MessageSquare />}
              label={streamLabel}
              open={showStream}
              onToggle={() => setShowStream(v => !v)}
              trailing={entryCount > 0 ? `${entryCount} event${entryCount !== 1 ? 's' : ''}` : undefined}
            />
            {showStream && (
              <div className="px-3 pb-3 bg-[var(--aw-bg-0)]/40">
                {isLive ? (
                  <CollapsibleStreamLog
                    entries={liveStreamEntries}
                    sessionId={sessionId}
                    isLive
                    loadingLabel="Starting analysis session..."
                  />
                ) : cycle.streamEntries && cycle.streamEntries.length > 0 ? (
                  <CollapsibleStreamLog
                    entries={cycle.streamEntries}
                    sessionId={sessionId}
                  />
                ) : cycle.analysisResponse ? (
                  <div className="max-h-[420px] overflow-y-auto pr-0.5">
                    <MarkdownRenderer content={cycle.analysisResponse} size="sm" />
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--aw-text-4)]">No response captured</p>
                )}
              </div>
            )}
          </div>

          {/* Execution findings — the primary payload of a cycle, always shown when present */}
          {recCount > 0 && (
            <div>
              <CycleSectionLabel icon={<ListChecks />} label="Execution Findings" count={recCount} />
              <div className="px-3 pb-3 space-y-1.5">
                {cycle.executionFindings!.map((rec, i) => (
                  <ExecutionFindingCard key={i} rec={rec} sessionId={sessionId} />
                ))}
              </div>
            </div>
          )}

          {/* Outcome findings — agents that complied but whose deliverable still fell short */}
          {outcomeCount > 0 && (
            <div>
              <CycleSectionLabel icon={<Target />} label="Outcome Findings" count={outcomeCount} />
              <div className="px-3 pb-3 space-y-1.5">
                {cycle.outcomeFindings!.map((finding, i) => (
                  <OutcomeFindingCard key={i} finding={finding} sessionId={sessionId} />
                ))}
              </div>
            </div>
          )}

          {/* Enhancement opportunities — agents that fully complied but could still get a better result */}
          {enhCount > 0 && (
            <div>
              <CycleSectionLabel icon={<TrendingUp />} label="Enhancement Opportunities" count={enhCount} />
              <div className="px-3 pb-3 space-y-1.5">
                {cycle.enhancementOpportunities!.map((opp, i) => (
                  <EnhancementOpportunityCard key={i} opp={opp} sessionId={sessionId} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Execution Finding Card ──────────────────────────────────────────────

function humanizeLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'var(--aw-green)',
  medium: 'var(--aw-yellow)',
  low: 'var(--aw-text-4)',
};

function ExecutionFindingCard({ rec, sessionId }: { rec: ExecutionFinding; sessionId: string }) {
  const addFeedback = useFeedbackStore(s => s.addFeedback);
  const { agentMap } = useSessionStore();
  const [expanded, setExpanded] = useState(false);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'adding' | 'added'>('idle');

  const validCategory = FEEDBACK_CATEGORIES.some(c => c.value === rec.feedbackCategory)
    ? (rec.feedbackCategory as FeedbackCategory)
    : 'other';

  // Resolved from the session's own agent data rather than trusting the
  // model to echo a name back — the id is all it needs to get right.
  const targetAgent = resolveAgentById(agentMap, rec.agentId);
  const targetAgentName = targetAgent
    ? (targetAgent.description?.slice(0, 60) || targetAgent.subagentType || targetAgent.type)
    : null;

  const handleAddFeedback = async () => {
    if (!rec.agentId || !rec.feedbackText || feedbackState !== 'idle') return;
    setFeedbackState('adding');
    const created = await addFeedback({
      sessionId,
      agentId: targetAgent?.id ?? rec.agentId,
      agentName: targetAgentName,
      category: validCategory,
      text: rec.feedbackText,
    });
    setFeedbackState(created ? 'added' : 'idle');
  };

  // The model's JSON is free-form text, not a validated schema — a
  // recommendation can arrive with any field missing, or with the model
  // having drifted to a different field name for the same concept
  // (`target`/`finding` instead of `title`/`observation` have both been
  // observed for otherwise-identical prompts). Fall back across both
  // rather than rendering a mostly-blank card.
  const severity = rec.severity || 'medium';
  const severityColor = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.medium;
  const heading = rec.title || rec.target || 'Recommendation';
  const body = rec.observation || rec.finding;
  // Only show target as its own field when it isn't already standing in for
  // the heading above.
  const showTarget = Boolean(rec.target && rec.title);

  return (
    <div className="rounded-r border-l-2 overflow-hidden" style={{ borderLeftColor: severityColor, background: `${severityColor}0a` }}>
      <button
        className="w-full flex items-center gap-2 p-2.5 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-[9px] uppercase font-semibold tracking-wider shrink-0 w-12" style={{ color: severityColor }}>
          {severity}
        </span>
        <span className="text-[11px] font-medium text-[var(--aw-text-0)] flex-1 min-w-0" title={heading}>{heading}</span>
        {rec.category && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-3)] shrink-0">
            {humanizeLabel(rec.category)}
          </span>
        )}
        {rec.confidence && (
          <span
            className="text-[9px] uppercase font-medium tracking-wider shrink-0"
            style={{ color: CONFIDENCE_COLOR[rec.confidence] ?? CONFIDENCE_COLOR.medium }}
            title="Confidence"
          >
            {rec.confidence}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2.5 border-t border-[var(--aw-bg-2)]">
          {body && <Field label="Observation">{body}</Field>}
          {rec.rootCause && <Field label="Root cause">{rec.rootCause}</Field>}
          {showTarget && (
            <Field label="Target">
              <span className="font-mono text-[10px] text-[var(--aw-text-2)] bg-[var(--aw-bg-4)] px-1.5 py-0.5 rounded break-all">
                {rec.target}
              </span>
            </Field>
          )}
          {rec.evidence && (
            <Field label={Array.isArray(rec.evidence) ? `Evidence (${rec.evidence.length})` : 'Evidence'}>
              {Array.isArray(rec.evidence) ? (
                <ul className="space-y-1">
                  {rec.evidence.map((e, i) => (
                    <li key={i} className="pl-2 border-l-2 border-[var(--aw-bg-3)] italic">{e}</li>
                  ))}
                </ul>
              ) : (
                <span className="italic">{rec.evidence}</span>
              )}
            </Field>
          )}
          {rec.recommendation && (
            <CalloutField label="Recommendation">{rec.recommendation}</CalloutField>
          )}

          {rec.agentId && rec.feedbackText && (
            <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] p-2.5">
              {targetAgentName && (
                <p className="text-[9px] text-[var(--aw-text-4)] mb-1">
                  Feedback for <span className="text-[var(--aw-text-2)] font-medium">{targetAgentName}</span>
                </p>
              )}
              <div className="flex items-end gap-2">
                <p className="text-[10px] text-[var(--aw-text-2)] flex-1 leading-relaxed">{rec.feedbackText}</p>
                <button
                  onClick={handleAddFeedback}
                  disabled={feedbackState !== 'idle'}
                  className={cn(
                    'flex items-center gap-1 text-[10px] px-2 py-1 rounded shrink-0 font-medium transition-colors',
                    feedbackState === 'added'
                      ? 'bg-[var(--aw-green)]/15 text-[var(--aw-green)]'
                      : 'bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                  title={`Add as feedback (${humanizeLabel(validCategory)})`}
                >
                  {feedbackState === 'added'
                    ? <Check className="h-3 w-3" />
                    : <MessageSquarePlus className="h-3 w-3" />}
                  {feedbackState === 'added' ? 'Added' : feedbackState === 'adding' ? 'Adding…' : 'Add as Feedback'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Outcome Finding Card ─────────────────────────────────────────────────

function OutcomeFindingCard({ finding, sessionId }: { finding: ExecutionOutcomeFinding; sessionId: string }) {
  const addFeedback = useFeedbackStore(s => s.addFeedback);
  const { agentMap } = useSessionStore();
  const [expanded, setExpanded] = useState(false);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'adding' | 'added'>('idle');

  const validCategory = FEEDBACK_CATEGORIES.some(c => c.value === finding.feedbackCategory)
    ? (finding.feedbackCategory as FeedbackCategory)
    : 'other';

  const targetAgent = resolveAgentById(agentMap, finding.agentId);
  const targetAgentName = targetAgent
    ? (targetAgent.description?.slice(0, 60) || targetAgent.subagentType || targetAgent.type)
    : null;

  const handleAddFeedback = async () => {
    if (!finding.agentId || !finding.feedbackText || feedbackState !== 'idle') return;
    setFeedbackState('adding');
    const created = await addFeedback({
      sessionId,
      agentId: targetAgent?.id ?? finding.agentId,
      agentName: targetAgentName,
      category: validCategory,
      text: finding.feedbackText,
    });
    setFeedbackState(created ? 'added' : 'idle');
  };

  const heading = finding.title || 'Outcome finding';

  return (
    <div className="rounded-r border-l-2 overflow-hidden" style={{ borderLeftColor: 'var(--aw-orange-bright)', background: 'var(--aw-orange-bright)0a' }}>
      <button
        className="w-full flex items-center gap-2 p-2.5 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <Target className="h-3 w-3 shrink-0" style={{ color: 'var(--aw-orange-bright)' }} />
        <span className="text-[11px] font-medium text-[var(--aw-text-0)] flex-1 min-w-0" title={heading}>{heading}</span>
        {finding.confidence && (
          <span
            className="text-[9px] uppercase font-medium tracking-wider shrink-0"
            style={{ color: CONFIDENCE_COLOR[finding.confidence] ?? CONFIDENCE_COLOR.medium }}
            title="Confidence"
          >
            {finding.confidence}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2.5 border-t border-[var(--aw-bg-2)]">
          {finding.whatWasExpected && <Field label="What the task needed">{finding.whatWasExpected}</Field>}
          {finding.whatWasProduced && <Field label="What was produced">{finding.whatWasProduced}</Field>}
          {finding.gap && <CalloutField label="Gap">{finding.gap}</CalloutField>}
          {finding.evidence && finding.evidence.length > 0 && (
            <Field label={`Evidence (${finding.evidence.length})`}>
              <ul className="space-y-1">
                {finding.evidence.map((e, i) => (
                  <li key={i} className="pl-2 border-l-2 border-[var(--aw-bg-3)] italic">{e}</li>
                ))}
              </ul>
            </Field>
          )}

          {finding.agentId && finding.feedbackText && (
            <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] p-2.5">
              {targetAgentName && (
                <p className="text-[9px] text-[var(--aw-text-4)] mb-1">
                  Feedback for <span className="text-[var(--aw-text-2)] font-medium">{targetAgentName}</span>
                </p>
              )}
              <div className="flex items-end gap-2">
                <p className="text-[10px] text-[var(--aw-text-2)] flex-1 leading-relaxed">{finding.feedbackText}</p>
                <button
                  onClick={handleAddFeedback}
                  disabled={feedbackState !== 'idle'}
                  className={cn(
                    'flex items-center gap-1 text-[10px] px-2 py-1 rounded shrink-0 font-medium transition-colors',
                    feedbackState === 'added'
                      ? 'bg-[var(--aw-green)]/15 text-[var(--aw-green)]'
                      : 'bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                  title={`Add as feedback (${humanizeLabel(validCategory)})`}
                >
                  {feedbackState === 'added'
                    ? <Check className="h-3 w-3" />
                    : <MessageSquarePlus className="h-3 w-3" />}
                  {feedbackState === 'added' ? 'Added' : feedbackState === 'adding' ? 'Adding…' : 'Add as Feedback'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Enhancement Opportunity Card ────────────────────────────────────────

function EnhancementOpportunityCard({ opp, sessionId }: { opp: ExecutionEnhancementOpportunity; sessionId: string }) {
  const addFeedback = useFeedbackStore(s => s.addFeedback);
  const { agentMap } = useSessionStore();
  const [expanded, setExpanded] = useState(false);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'adding' | 'added'>('idle');

  const validCategory = FEEDBACK_CATEGORIES.some(c => c.value === opp.feedbackCategory)
    ? (opp.feedbackCategory as FeedbackCategory)
    : 'other';

  const targetAgent = resolveAgentById(agentMap, opp.agentId);
  const targetAgentName = targetAgent
    ? (targetAgent.description?.slice(0, 60) || targetAgent.subagentType || targetAgent.type)
    : null;

  const handleAddFeedback = async () => {
    if (!opp.agentId || !opp.feedbackText || feedbackState !== 'idle') return;
    setFeedbackState('adding');
    const created = await addFeedback({
      sessionId,
      agentId: targetAgent?.id ?? opp.agentId,
      agentName: targetAgentName,
      category: validCategory,
      text: opp.feedbackText,
    });
    setFeedbackState(created ? 'added' : 'idle');
  };

  const heading = opp.title || 'Enhancement opportunity';

  return (
    <div className="rounded-r border-l-2 overflow-hidden" style={{ borderLeftColor: 'var(--aw-blue)', background: 'var(--aw-blue)0a' }}>
      <button
        className="w-full flex items-center gap-2 p-2.5 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <TrendingUp className="h-3 w-3 shrink-0" style={{ color: 'var(--aw-blue)' }} />
        <span className="text-[11px] font-medium text-[var(--aw-text-0)] flex-1 min-w-0" title={heading}>{heading}</span>
        {targetAgentName && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-3)] shrink-0 truncate max-w-[140px]" title={targetAgentName}>
            {targetAgentName}
          </span>
        )}
        {opp.confidence && (
          <span
            className="text-[9px] uppercase font-medium tracking-wider shrink-0"
            style={{ color: CONFIDENCE_COLOR[opp.confidence] ?? CONFIDENCE_COLOR.medium }}
            title="Confidence"
          >
            {opp.confidence}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2.5 border-t border-[var(--aw-bg-2)]">
          {opp.currentInstruction && <Field label="Current instruction">{opp.currentInstruction}</Field>}
          {opp.observation && <Field label="Observation">{opp.observation}</Field>}
          {opp.evidence && opp.evidence.length > 0 && (
            <Field label={`Evidence (${opp.evidence.length})`}>
              <ul className="space-y-1">
                {opp.evidence.map((e, i) => (
                  <li key={i} className="pl-2 border-l-2 border-[var(--aw-bg-3)] italic">{e}</li>
                ))}
              </ul>
            </Field>
          )}
          {opp.suggestedEnhancement && (
            <CalloutField label="Suggested enhancement">{opp.suggestedEnhancement}</CalloutField>
          )}
          {opp.expectedBenefit && <Field label="Expected benefit">{opp.expectedBenefit}</Field>}

          {opp.agentId && opp.feedbackText && (
            <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] p-2.5">
              {targetAgentName && (
                <p className="text-[9px] text-[var(--aw-text-4)] mb-1">
                  Feedback for <span className="text-[var(--aw-text-2)] font-medium">{targetAgentName}</span>
                </p>
              )}
              <div className="flex items-end gap-2">
                <p className="text-[10px] text-[var(--aw-text-2)] flex-1 leading-relaxed">{opp.feedbackText}</p>
                <button
                  onClick={handleAddFeedback}
                  disabled={feedbackState !== 'idle'}
                  className={cn(
                    'flex items-center gap-1 text-[10px] px-2 py-1 rounded shrink-0 font-medium transition-colors',
                    feedbackState === 'added'
                      ? 'bg-[var(--aw-green)]/15 text-[var(--aw-green)]'
                      : 'bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                  title={`Add as feedback (${humanizeLabel(validCategory)})`}
                >
                  {feedbackState === 'added'
                    ? <Check className="h-3 w-3" />
                    : <MessageSquarePlus className="h-3 w-3" />}
                  {feedbackState === 'added' ? 'Added' : feedbackState === 'adding' ? 'Adding…' : 'Add as Feedback'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
