'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronRight, Play, Check, X, AlertTriangle, Clock,
  Loader2, Trash2, FileText, Brain, Terminal, Wrench, Eye,
  Activity, TrendingUp, Copy, Map as MapIcon,
} from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { InfoTooltip } from '@/components/shared/cycle-section';
import { ModelSelect } from '@/components/shared/model-select';
import { StopButton } from '@/components/shared/stop-button';
import { CopyableSessionId } from '@/components/shared/copyable-session-id';
import { cn } from '@/lib/utils';
import type { SkillAnalysisCycle, AnalysisRecommendation, SkillGrowthOpportunity, PhaseGrowthOpportunity } from '@/types/skills';
import type { StreamEntry } from '@/types/feedback';

interface AnalysisHistoryProps {
  skillId: string;
  cycles: SkillAnalysisCycle[];
}

type DetailTab = 'overview' | 'activity' | 'report' | 'prompt';

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'var(--aw-text-2)', icon: <Clock className="h-3 w-3" />, label: 'Pending' },
  analyzing: { color: 'var(--aw-purple-light)', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Analyzing' },
  awaiting_review: { color: 'var(--aw-orange-bright)', icon: <AlertTriangle className="h-3 w-3" />, label: 'Awaiting Review' },
  applying: { color: 'var(--aw-blue)', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Applying' },
  completed: { color: 'var(--aw-green)', icon: <Check className="h-3 w-3" />, label: 'Completed' },
  failed: { color: 'var(--aw-red-bright)', icon: <X className="h-3 w-3" />, label: 'Failed' },
  cancelled: { color: 'var(--aw-text-3)', icon: <X className="h-3 w-3" />, label: 'Cancelled' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-l-[var(--aw-red-bright)] bg-[var(--aw-red-bright)]/5',
  high: 'border-l-[var(--aw-orange-bright)] bg-[var(--aw-orange-bright)]/5',
  medium: 'border-l-[var(--aw-purple-light)] bg-[var(--aw-purple-light)]/5',
  low: 'border-l-[var(--aw-text-2)] bg-[var(--aw-text-2)]/5',
};


function getToolSummaryText(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') return String(toolInput?.command ?? '').slice(0, 80);
  if (toolName === 'Read') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/');
  if (toolName === 'Edit') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (edit)';
  if (toolName === 'Write') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (write)';
  if (toolName === 'Grep') return `"${String(toolInput?.pattern ?? '').slice(0, 40)}"`;
  if (toolName === 'Glob') return String(toolInput?.pattern ?? '').slice(0, 40);
  if (toolName === 'Agent') return String(toolInput?.description ?? toolInput?.prompt ?? '').slice(0, 60);
  return JSON.stringify(toolInput).slice(0, 60);
}

function formatToolInput(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') return String(toolInput?.command ?? '');
  if (toolName === 'Read') return String(toolInput?.file_path ?? '');
  if (toolName === 'Edit') {
    const fp = String(toolInput?.file_path ?? '');
    const old = String(toolInput?.old_string ?? '');
    const nw = String(toolInput?.new_string ?? '');
    return `File: ${fp}\n\n--- old\n${old}\n+++ new\n${nw}`;
  }
  if (toolName === 'Write') {
    const fp = String(toolInput?.file_path ?? '');
    const content = String(toolInput?.content ?? '');
    return `File: ${fp}\n\n${content.slice(0, 2000)}${content.length > 2000 ? '\n...(truncated)' : ''}`;
  }
  if (toolName === 'Grep') return `pattern: ${toolInput?.pattern ?? ''}\npath: ${toolInput?.path ?? '.'}`;
  return JSON.stringify(toolInput, null, 2);
}

export function AnalysisHistory({ skillId, cycles }: AnalysisHistoryProps) {
  const {
    triggerAnalysis, stopAnalysis, approveFixPrompt, deleteAnalysisCycle, previewPrompt,
    loadAnalysisCycles, isAnalyzing, isStopping, streamEntries, model, setModel,
  } = useSkillStore();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [editingFixPrompt, setEditingFixPrompt] = useState<string | null>(null);
  const [fixPromptText, setFixPromptText] = useState('');

  // Prompt preview/edit flow
  const [promptStep, setPromptStep] = useState<'idle' | 'loading' | 'editing'>('idle');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'edit'>('preview');

  // The panel to show is derived, not synced via effect: an explicit pick
  // wins if it still exists in `cycles`; otherwise fall back to the newest
  // cycle, which also naturally recovers if the selected one gets deleted.
  const selectedCycle = (selectedCycleId ? cycles.find(c => c.id === selectedCycleId) : undefined)
    ?? cycles[0]
    ?? null;

  const selectCycle = (cycleId: string) => {
    setSelectedCycleId(cycleId);
    setActiveTab('overview');
  };

  const handlePreview = async () => {
    setPromptStep('loading');
    const p = await previewPrompt(skillId);
    if (p) { setPromptDraft(p); setPromptViewMode('preview'); setPromptStep('editing'); }
    else setPromptStep('idle');
  };

  // The trigger endpoint creates the cycle row and returns it immediately,
  // but the store's `cycles` list only reflects it after a reload — without
  // this, the newly-running cycle wouldn't be selectable until it completes.
  const startAnalysis = async (customPrompt?: string) => {
    const cycle = await triggerAnalysis(skillId, customPrompt);
    if (cycle) {
      await loadAnalysisCycles(skillId);
      setSelectedCycleId(cycle.id);
      setActiveTab('activity');
    }
  };

  const handleTrigger = async () => {
    const customPrompt = promptStep === 'editing' ? promptDraft : undefined;
    setPromptStep('idle');
    await startAnalysis(customPrompt);
  };

  const handleApprove = async (cycleId: string) => {
    const prompt = editingFixPrompt === cycleId ? fixPromptText : undefined;
    await approveFixPrompt(skillId, cycleId, prompt);
    setEditingFixPrompt(null);
  };

  const handleDelete = async (cycleId: string) => {
    await deleteAnalysisCycle(skillId, cycleId);
  };

  // Prompt editor view
  if (promptStep === 'editing') {
    return (
      <div className="space-y-3">
        {/* Editor header */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-lg bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)]">
          <FileText className="h-3.5 w-3.5 text-[var(--aw-purple-light)] shrink-0" />
          <span className="text-xs font-semibold text-[var(--aw-text-0)] flex-1">Review & Edit Analysis Prompt</span>
          {/* Preview / Edit toggle */}
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
          <span className="shrink-0 text-[10px] text-[var(--aw-text-4)] font-mono tabular-nums">
            {promptDraft.length.toLocaleString()} chars
          </span>
        </div>

        {/* Content */}
        {promptViewMode === 'preview' ? (
          <div className="px-4 py-3 bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded overflow-y-auto max-h-[500px]">
            <MarkdownRenderer content={promptDraft} size="sm" />
          </div>
        ) : (
          <textarea
            value={promptDraft}
            onChange={e => setPromptDraft(e.target.value)}
            className="w-full h-[500px] px-3 py-2.5 bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded text-[11px] text-[var(--aw-text-1)] font-mono leading-relaxed focus:outline-none focus:border-[var(--aw-purple-light)]/50 resize-y"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTrigger();
              if (e.key === 'Escape') setPromptStep('idle');
            }}
          />
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTrigger}
            disabled={!promptDraft.trim() || isAnalyzing}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
          <ModelSelect value={model} onChange={setModel} disabled={isAnalyzing} />
          {isAnalyzing && <StopButton onClick={() => stopAnalysis(skillId)} stopping={isStopping} />}
          <button
            onClick={() => setPromptStep('idle')}
            className="px-4 py-2 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--aw-text-2)]">
          {cycles.length} analysis cycle{cycles.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={isAnalyzing || promptStep === 'loading'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)] transition-colors font-medium disabled:opacity-50"
          >
            {promptStep === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            {promptStep === 'loading' ? 'Loading...' : 'Preview Prompt'}
          </button>
          <ModelSelect value={model} onChange={setModel} disabled={isAnalyzing} />
          <button
            onClick={() => startAnalysis()}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white transition-colors font-medium disabled:opacity-50"
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isAnalyzing ? 'Analyzing...' : 'Quick Analysis'}
          </button>
          {isAnalyzing && <StopButton onClick={() => stopAnalysis(skillId)} stopping={isStopping} />}
        </div>
      </div>

      {cycles.length === 0 && !isAnalyzing ? (
        <div className="text-center py-12 text-[var(--aw-text-4)]">
          <Brain className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-xs font-medium text-[var(--aw-text-2)]">No analysis cycles yet</p>
          <p className="text-[11px] mt-1 text-[var(--aw-text-4)]">
            Click &quot;Preview Prompt&quot; to review the generated analysis prompt, or &quot;Quick Analysis&quot; to start immediately.
          </p>
        </div>
      ) : (
        <div className="flex gap-3 h-[640px]">
          <CycleList
            cycles={cycles}
            selectedId={selectedCycleId}
            isAnalyzing={isAnalyzing}
            onSelect={selectCycle}
            onDelete={handleDelete}
          />
          <CycleDetailPanel
            cycle={selectedCycle}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isAnalyzing={isAnalyzing}
            liveStreamEntries={streamEntries}
            onApprove={() => selectedCycle && handleApprove(selectedCycle.id)}
            editingFixPrompt={editingFixPrompt}
            fixPromptText={fixPromptText}
            onStartEditFixPrompt={(text) => {
              if (!selectedCycle) return;
              setFixPromptText(text);
              setEditingFixPrompt(selectedCycle.id);
            }}
            onCancelEditFixPrompt={() => setEditingFixPrompt(null)}
            onFixPromptChange={setFixPromptText}
          />
        </div>
      )}
    </div>
  );
}

// ── Cycle List (left pane) ───────────────────────────────────────────────────────

function CycleList({ cycles, selectedId, isAnalyzing, onSelect, onDelete }: {
  cycles: SkillAnalysisCycle[];
  selectedId: string | null;
  isAnalyzing: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="w-64 shrink-0 rounded-lg border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)] overflow-y-auto">
      {cycles.length === 0 && isAnalyzing && (
        <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-[var(--aw-purple-light)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Starting analysis…
        </div>
      )}
      {cycles.map(cycle => (
        <CycleListItem
          key={cycle.id}
          cycle={cycle}
          isSelected={cycle.id === selectedId}
          onSelect={() => onSelect(cycle.id)}
          onDelete={() => onDelete(cycle.id)}
        />
      ))}
    </div>
  );
}

function CycleListItem({ cycle, isSelected, onSelect, onDelete }: {
  cycle: SkillAnalysisCycle;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_CONFIG[cycle.status] ?? STATUS_CONFIG.pending;
  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const recCount = cycle.recommendations?.length ?? 0;
  const growthCount = cycle.growthOpportunities?.length ?? 0;
  const phaseGrowthCount = cycle.phaseGrowthOpportunities?.length ?? 0;

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex flex-col gap-1 px-3 py-2.5 border-b border-[var(--aw-bg-2)] cursor-pointer transition-colors',
        isSelected ? 'bg-[var(--aw-bg-2)]' : 'hover:bg-[var(--aw-bg-2)]/50',
      )}
      style={{ borderLeftWidth: '3px', borderLeftColor: status.color }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-[var(--aw-text-0)] shrink-0">#{cycle.cycleNumber}</span>
        <span
          className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
          style={{ color: status.color, background: `${status.color}18` }}
        >
          {status.icon}
          {status.label}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-4)] hover:text-[var(--aw-red-bright)] transition-opacity shrink-0"
          title="Delete cycle"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="text-[10px] text-[var(--aw-text-4)] truncate">
        {cycle.triggerType === 'auto_threshold' ? 'Auto' : 'Manual'} · {date}
      </div>
      {(cycle.model || cycle.cliSessionId) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {cycle.model && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] whitespace-nowrap shrink-0"
              title="Model the CLI actually ran with"
            >
              {cycle.model}
            </span>
          )}
          {cycle.cliSessionId && <CopyableSessionId sessionId={cycle.cliSessionId} />}
        </div>
      )}
      {(recCount > 0 || growthCount > 0 || phaseGrowthCount > 0) && (
        <div className="flex items-center gap-1.5">
          {recCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--aw-purple-light)]/10 text-[var(--aw-purple-light)]">
              {recCount} fix{recCount !== 1 ? 'es' : ''}
            </span>
          )}
          {growthCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--aw-green)]/10 text-[var(--aw-green)]">
              {growthCount} growth
            </span>
          )}
          {phaseGrowthCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--aw-blue)]/10 text-[var(--aw-blue)]">
              {phaseGrowthCount} phase
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cycle Detail Panel (right pane) ──────────────────────────────────────────────

interface CycleDetailPanelProps {
  cycle: SkillAnalysisCycle | null;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  isAnalyzing: boolean;
  liveStreamEntries: StreamEntry[];
  onApprove: () => void;
  editingFixPrompt: string | null;
  fixPromptText: string;
  onStartEditFixPrompt: (text: string) => void;
  onCancelEditFixPrompt: () => void;
  onFixPromptChange: (text: string) => void;
}

function CycleDetailPanel({
  cycle, activeTab, onTabChange, isAnalyzing, liveStreamEntries,
  onApprove, editingFixPrompt, fixPromptText, onStartEditFixPrompt, onCancelEditFixPrompt, onFixPromptChange,
}: CycleDetailPanelProps) {
  if (!cycle) {
    return (
      <div className="flex-1 rounded-lg border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)] flex items-center justify-center">
        {isAnalyzing ? (
          <div className="flex items-center gap-2 text-xs text-[var(--aw-purple-light)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting analysis…
          </div>
        ) : (
          <span className="text-xs text-[var(--aw-text-4)]">Select a cycle</span>
        )}
      </div>
    );
  }

  const isLiveNow = (cycle.status === 'analyzing' || cycle.status === 'applying') && isAnalyzing;
  const isStaleAnalyzing = (cycle.status === 'analyzing' || cycle.status === 'applying') && !isAnalyzing;
  const displayStatus = isStaleAnalyzing ? 'failed' : cycle.status;
  const status = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.pending;
  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const streamEntries = isLiveNow ? liveStreamEntries : cycle.streamEntries ?? [];
  const hasStream = streamEntries.length > 0 || isLiveNow;
  const hasReport = !!cycle.analysisResponse;
  const hasSummary = !!cycle.currentStatus
    || (cycle.recommendations?.length ?? 0) > 0
    || (cycle.growthOpportunities?.length ?? 0) > 0
    || (cycle.phaseGrowthOpportunities?.length ?? 0) > 0
    || !!cycle.fixPrompt;

  const tabs: Array<{ key: DetailTab; label: string; show: boolean }> = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'activity', label: hasStream ? `Activity (${streamEntries.length})` : 'Activity', show: hasStream },
    { key: 'report', label: 'Report', show: hasReport },
    { key: 'prompt', label: 'Prompt', show: true },
  ];
  const visibleTabs = tabs.filter(t => t.show);
  const tab = visibleTabs.some(t => t.key === activeTab) ? activeTab : 'overview';

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--aw-bg-2)] shrink-0">
        <span className="text-sm font-bold text-[var(--aw-text-0)]">Cycle #{cycle.cycleNumber}</span>
        <span
          className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ color: status.color, background: `${status.color}18` }}
        >
          {status.icon}
          {status.label}
        </span>
        {cycle.model && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)]"
            title="Model the CLI actually ran with"
          >
            {cycle.model}
          </span>
        )}
        {cycle.cliSessionId && (
          <CopyableSessionId
            sessionId={cycle.cliSessionId}
            className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors shrink-0"
          />
        )}
        <span className="text-[11px] text-[var(--aw-text-4)] ml-auto">
          {cycle.triggerType === 'auto_threshold' ? 'Auto' : 'Manual'} · {date}
        </span>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-[var(--aw-bg-2)] shrink-0">
        {visibleTabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={cn(
              'text-[11px] font-medium px-2.5 py-1.5 rounded-t transition-colors border-b-2 -mb-px',
              tab === t.key
                ? 'border-[var(--aw-blue)] text-[var(--aw-text-0)]'
                : 'border-transparent text-[var(--aw-text-3)] hover:text-[var(--aw-text-0)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <OverviewTab
            cycle={cycle}
            hasSummary={hasSummary}
            onApprove={onApprove}
            editingFixPrompt={editingFixPrompt}
            fixPromptText={fixPromptText}
            onStartEditFixPrompt={onStartEditFixPrompt}
            onCancelEditFixPrompt={onCancelEditFixPrompt}
            onFixPromptChange={onFixPromptChange}
          />
        )}
        {tab === 'activity' && <StreamLog entries={streamEntries} isLive={isLiveNow} />}
        {tab === 'report' && cycle.analysisResponse && (
          <MarkdownRenderer content={cycle.analysisResponse} size="sm" />
        )}
        {tab === 'prompt' && (
          <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap font-mono bg-[var(--aw-bg-4)] p-3 rounded border border-[var(--aw-bg-2)] leading-relaxed">
            {cycle.analysisPrompt}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Overview tab content ─────────────────────────────────────────────────────────

function OverviewTab({ cycle, hasSummary, onApprove, editingFixPrompt, fixPromptText, onStartEditFixPrompt, onCancelEditFixPrompt, onFixPromptChange }: {
  cycle: SkillAnalysisCycle;
  hasSummary: boolean;
  onApprove: () => void;
  editingFixPrompt: string | null;
  fixPromptText: string;
  onStartEditFixPrompt: (text: string) => void;
  onCancelEditFixPrompt: () => void;
  onFixPromptChange: (text: string) => void;
}) {
  if (!hasSummary) {
    return (
      <div className="text-center py-8 text-[var(--aw-text-4)]">
        <p className="text-xs">
          {cycle.status === 'analyzing' || cycle.status === 'applying'
            ? 'Results will appear here once the run finishes — check Activity for live progress.'
            : 'No findings recorded for this cycle.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <span className="text-[var(--aw-text-2)]">Sessions analyzed:</span>{' '}
          <span className="text-[var(--aw-text-1)] font-medium">{cycle.sessionsAnalyzed.length}</span>
        </div>
        <div>
          <span className="text-[var(--aw-text-2)]">Feedback analyzed:</span>{' '}
          <span className="text-[var(--aw-text-1)] font-medium">{cycle.feedbackAnalyzed.length}</span>
        </div>
      </div>

      {cycle.currentStatus && (
        <CalloutField
          label="Current Status"
          tone="purple"
          icon={<Activity className="h-3 w-3" />}
          size="base"
          tooltip="A quick summary of how well this skill has been working overall, based on everything recorded about it so far — not just this one report."
        >
          <MarkdownRenderer content={cycle.currentStatus} size="base" />
        </CalloutField>
      )}

      {cycle.recommendations && cycle.recommendations.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wider">
              Recommendations ({cycle.recommendations.length})
            </span>
            <InfoTooltip text="Specific problems found in past runs of this skill, along with proof and how sure we are about each one." />
          </div>
          <div className="space-y-2">
            {cycle.recommendations.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
          </div>
        </div>
      )}

      {cycle.growthOpportunities && cycle.growthOpportunities.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3 w-3 text-[var(--aw-green)]" />
            <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wider">
              Growth Opportunities ({cycle.growthOpportunities.length})
            </span>
            <InfoTooltip text="Not fixes for something broken — ideas for how this skill could do more, or do it better." />
          </div>
          <div className="space-y-2">
            {cycle.growthOpportunities.map((op, i) => <GrowthOpportunityCard key={i} op={op} />)}
          </div>
        </div>
      )}

      {cycle.phaseGrowthOpportunities && cycle.phaseGrowthOpportunities.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MapIcon className="h-3 w-3 text-[var(--aw-blue)]" />
            <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wider">
              Phase-Level Growth Opportunities ({cycle.phaseGrowthOpportunities.length})
            </span>
            <InfoTooltip text="Looks beyond this one skill, at the bigger stage of work it's part of, and suggests improvements there too." />
          </div>
          <div className="space-y-2">
            {cycle.phaseGrowthOpportunities.map((op, i) => <PhaseGrowthOpportunityCard key={i} op={op} />)}
          </div>
        </div>
      )}

      {cycle.fixPrompt && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wider">Fix Prompt</span>
            <CopyButton text={editingFixPrompt === cycle.id ? fixPromptText : cycle.fixPrompt} />
          </div>
          {editingFixPrompt === cycle.id ? (
            <textarea
              value={fixPromptText}
              onChange={e => onFixPromptChange(e.target.value)}
              className="w-full h-40 text-[11px] bg-[var(--aw-bg-4)] border border-[var(--aw-bg-3)] rounded p-2.5 text-[var(--aw-text-1)] font-mono resize-y focus:outline-none focus:border-[var(--aw-blue)]/50"
            />
          ) : (
            <pre className="bg-[var(--aw-bg-4)] rounded border border-[var(--aw-bg-2)] p-3 text-[10px] text-[var(--aw-text-1)] max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
              {cycle.fixPrompt}
            </pre>
          )}

          {cycle.status === 'awaiting_review' && (
            <div className="flex items-center gap-2 mt-2.5">
              {editingFixPrompt === cycle.id ? (
                <>
                  <button
                    onClick={onApprove}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Apply Edited Prompt
                  </button>
                  <button
                    onClick={onCancelEditFixPrompt}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onApprove}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve & Apply
                  </button>
                  <button
                    onClick={() => onStartEditFixPrompt(cycle.fixPrompt!)}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)]"
                  >
                    Edit Fix Prompt
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {cycle.completedAt && (
        <div className="text-[10px] text-[var(--aw-text-4)] pt-2 border-t border-[var(--aw-bg-2)]">
          Completed {new Date(cycle.completedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </div>
      )}
    </div>
  );
}

// ── Stream Log ──────────────────────────────────────────────────────────────────

function StreamLog({ entries, isLive = false }: { entries: StreamEntry[]; isLive?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length, isLive]);

  if (entries.length === 0 && isLive) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--aw-blue)]">
        <Loader2 className="h-3 w-3 animate-spin" /> Starting analysis...
      </div>
    );
  }

  if (entries.length === 0) return null;

  const resultMap = new Map<string, StreamEntry>();
  for (const e of entries) {
    if (e.kind === 'tool_result' && e.toolUseId) {
      resultMap.set(e.toolUseId, e);
    }
  }

  return (
    <div
      ref={scrollRef}
      className={cn('overflow-y-auto pr-0.5', isLive ? 'max-h-[500px]' : 'max-h-[600px]')}
    >
      {entries.map(entry => {
        if (entry.kind === 'system') {
          return (
            <div key={entry.id} className="flex items-center gap-1.5 py-0.5 text-[9px] text-[var(--aw-text-4)]">
              <Terminal className="h-2.5 w-2.5 shrink-0" />
              <span>{entry.text}</span>
            </div>
          );
        }

        if (entry.kind === 'thinking') {
          return <ThinkingEntry key={entry.id} entry={entry} />;
        }

        if (entry.kind === 'tool_use') {
          const result = entry.toolUseId ? resultMap.get(entry.toolUseId) : undefined;
          return <ToolCallEntry key={entry.id} entry={entry} result={result} />;
        }

        if (entry.kind === 'tool_result') {
          if (entry.toolUseId && resultMap.has(entry.toolUseId)) return null;
          const isError = entry.isError;
          const content = entry.content ?? '';
          return (
            <div key={entry.id} className="ml-4 py-0.5">
              <div className={cn(
                'text-[9px] font-mono rounded px-1.5 py-0.5 max-h-16 overflow-y-auto',
                isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
              )}>
                {content.length > 200 ? content.slice(0, 200) + '…' : content}
              </div>
            </div>
          );
        }

        if (entry.kind === 'text') {
          return <TextEntry key={entry.id} entry={entry} />;
        }

        return null;
      })}
      {isLive && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--aw-blue)] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing...
        </div>
      )}
    </div>
  );
}

// ── Stream Entry Components ─────────────────────────────────────────────────────

function ThinkingEntry({ entry }: { entry: StreamEntry }) {
  const [expanded, setExpanded] = useState(false);
  const text = entry.text ?? '';
  const hasContent = text.length > 0 && text !== 'Thinking...';
  const preview = hasContent ? text.slice(0, 100) + (text.length > 100 ? '…' : '') : 'Thinking...';

  return (
    <div className="group">
      <button
        className="w-full flex items-center gap-1.5 px-1.5 py-1 hover:bg-[var(--aw-bg-2)]/30 rounded transition-colors text-left"
        onClick={() => hasContent && setExpanded(v => !v)}
      >
        <Brain className="h-2.5 w-2.5 text-[var(--aw-text-4)] shrink-0" />
        <span className="text-[9px] text-[var(--aw-text-4)]">thinking</span>
        <span className="text-[9px] text-[var(--aw-text-4)] italic truncate flex-1 opacity-70">{preview}</span>
        {hasContent && (
          <ChevronRight className={cn('h-2 w-2 text-[var(--aw-text-4)] shrink-0 transition-transform opacity-0 group-hover:opacity-100', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && hasContent && (
        <div className="ml-4 mt-0.5 mb-1">
          <pre className="text-[9px] text-[var(--aw-text-3)] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed bg-[var(--aw-bg-0)] rounded px-2 py-1.5 border border-[var(--aw-bg-2)]">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCallEntry({ entry, result }: { entry: StreamEntry; result?: StreamEntry }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = entry.toolName ?? 'Unknown';
  const toolInput = entry.toolInput ?? {};
  const summary = getToolSummaryText(toolName, toolInput);

  const resultContent = result?.content ?? '';
  const isError = result?.isError ?? false;

  const resultBadge = isError ? 'error' : result ? 'ok' : null;

  const ToolIcon = toolName === 'Bash' ? Terminal
    : toolName === 'Read' ? Eye
    : (toolName === 'Edit' || toolName === 'Write') ? Wrench
    : (toolName === 'Grep' || toolName === 'Glob') ? Eye
    : Wrench;

  return (
    <div className="group">
      <button
        className="w-full flex items-center gap-1.5 px-1.5 py-1 hover:bg-[var(--aw-bg-2)]/30 rounded transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <ToolIcon className="h-2.5 w-2.5 shrink-0 text-[var(--aw-text-4)]" />
        <span className="text-[9px] font-medium text-[var(--aw-text-3)]">{toolName}</span>
        <span className="text-[9px] text-[var(--aw-text-4)] font-mono truncate flex-1">{summary}</span>
        {resultBadge && (
          <span className={cn(
            'text-[8px] px-1 py-0.5 rounded shrink-0',
            isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
          )}>
            {resultBadge}
          </span>
        )}
        <ChevronRight className={cn('h-2 w-2 text-[var(--aw-text-4)] shrink-0 transition-transform opacity-0 group-hover:opacity-100', expanded && 'rotate-90 opacity-100')} />
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 space-y-1.5">
          <div>
            <div className="text-[8px] text-[var(--aw-text-4)] uppercase tracking-wider mb-0.5">Input</div>
            <pre className="text-[9px] font-mono text-[var(--aw-text-2)] bg-[var(--aw-bg-0)] rounded p-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed border border-[var(--aw-bg-2)]">
              {formatToolInput(toolName, toolInput)}
            </pre>
          </div>
          {result && (
            <div>
              <div className={cn(
                'text-[8px] uppercase tracking-wider mb-0.5',
                isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
              )}>
                {isError ? 'Error' : 'Output'}
              </div>
              <pre className={cn(
                'text-[9px] font-mono rounded p-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed border',
                isError ? 'text-[var(--aw-red-bright)] bg-[var(--aw-red)]/5 border-[var(--aw-red)]/20' : 'text-[var(--aw-text-2)] bg-[var(--aw-bg-0)] border-[var(--aw-bg-2)]',
              )}>
                {resultContent.length > 2000 ? resultContent.slice(0, 2000) + '\n...(truncated)' : resultContent || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextEntry({ entry }: { entry: StreamEntry }) {
  const text = entry.text ?? '';
  const isLong = text.length > 500;

  return (
    <div className="rounded-md border-l-2 border-l-[var(--aw-blue)] bg-[var(--aw-bg-0)] px-3 py-2 my-1">
      <div className={cn('text-[11px] text-[var(--aw-text-0)] leading-relaxed', isLong && 'max-h-[500px] overflow-y-auto')}>
        <MarkdownRenderer content={text} size="sm" />
      </div>
    </div>
  );
}

// ── Recommendation Card ─────────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'var(--aw-green)',
  medium: 'var(--aw-orange-bright)',
  low: 'var(--aw-text-4)',
};

// Shared label-over-value block used by both cards' expanded detail — a
// small uppercase caption keeps each field scannable instead of running
// label and prose together on one line.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-text-3)] mb-1">{label}</div>
      <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{children}</div>
    </div>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions, insecure context) — nothing to fall back to
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[10px] text-[var(--aw-text-3)] hover:text-[var(--aw-text-0)] transition-colors shrink-0"
    >
      {copied ? <Check className="h-3 w-3 text-[var(--aw-green)]" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

const CALLOUT_TONES: Record<'green' | 'purple', string> = {
  green: 'var(--aw-green)',
  purple: 'var(--aw-purple-light)',
};

function CalloutField({ label, children, tone = 'green', icon, size = 'sm', tooltip }: {
  label: string;
  children: React.ReactNode;
  tone?: 'green' | 'purple';
  icon?: React.ReactNode;
  size?: 'sm' | 'base';
  tooltip?: string;
}) {
  const color = CALLOUT_TONES[tone];
  return (
    <div className="rounded-lg border p-3.5" style={{ borderColor: `${color}40`, background: `${color}0d` }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color }}>
        {icon}
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className={cn(size === 'base' ? 'text-[13px]' : 'text-[11px]', 'text-[var(--aw-text-1)] leading-relaxed')}>{children}</div>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: AnalysisRecommendation }) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = SEVERITY_COLORS[rec.severity] ?? SEVERITY_COLORS.low;

  return (
    <div className={cn('border-l-2 rounded-r overflow-hidden', colorClass)}>
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--aw-text-2)] shrink-0 w-14">
          {rec.severity}
        </span>
        <span className="text-xs font-medium text-[var(--aw-text-0)] flex-1">{rec.title}</span>
        {rec.confidence && (
          <span
            className="text-[9px] uppercase font-medium tracking-wider shrink-0"
            style={{ color: CONFIDENCE_COLORS[rec.confidence] ?? CONFIDENCE_COLORS.low }}
            title="Confidence"
          >
            {rec.confidence} confidence
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2.5 space-y-3 border-t border-[var(--aw-bg-2)]">
          <Field label="Root cause">{rec.rootCause}</Field>

          <Field label="Affected component">
            <span className="font-mono text-[10px] text-[var(--aw-text-2)] bg-[var(--aw-bg-4)] px-1.5 py-0.5 rounded break-all">
              {rec.affectedComponent}
            </span>
          </Field>

          <CalloutField label="Proposed change">{rec.proposedChange}</CalloutField>

          {rec.evidence && rec.evidence.length > 0 && (
            <Field label={`Evidence (${rec.evidence.length})`}>
              <ul className="space-y-1.5">
                {rec.evidence.map((e, i) => (
                  <li key={i} className="pl-2.5 border-l-2 border-[var(--aw-bg-3)]">{e}</li>
                ))}
              </ul>
            </Field>
          )}

          {rec.selfCorrectionSignal && (
            <Field label="Self-correction signal">
              <span className="italic text-[var(--aw-text-2)]">{rec.selfCorrectionSignal}</span>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

// ── Growth Opportunity Card ─────────────────────────────────────────────────────

function GrowthOpportunityCard({ op }: { op: SkillGrowthOpportunity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-2 border-l-[var(--aw-green)] bg-[var(--aw-green)]/5 rounded-r overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        {op.impact && (
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--aw-text-2)] shrink-0 w-14">
            {op.impact}
          </span>
        )}
        <span className="text-xs font-medium text-[var(--aw-text-0)] flex-1">{op.title}</span>
        {op.sourceDocument && (
          <span
            className="text-[9px] text-[var(--aw-text-4)] font-mono shrink-0 truncate max-w-[140px]"
            title={op.sourceEvidence ? `${op.sourceDocument} — ${op.sourceEvidence}` : op.sourceDocument}
          >
            {op.sourceDocument}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2.5 space-y-3 border-t border-[var(--aw-bg-2)]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-text-3)] mb-1">Current state</div>
              <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{op.currentState}</div>
            </div>
            <div className="rounded border border-[var(--aw-green)]/25 bg-[var(--aw-green)]/5 p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-green)] mb-1">Target state</div>
              <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{op.targetState}</div>
            </div>
          </div>

          {op.sourceEvidence && <Field label="Source evidence">{op.sourceEvidence}</Field>}
          <Field label="Why it matters">{op.rationale}</Field>
          <Field label="SDLC impact">{op.sdlcImpact}</Field>
          <CalloutField label="Suggested change">{op.suggestedChange}</CalloutField>
        </div>
      )}
    </div>
  );
}

// ── Phase-Level Growth Opportunity Card ─────────────────────────────────────────

function PhaseGrowthOpportunityCard({ op }: { op: PhaseGrowthOpportunity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-2 border-l-[var(--aw-blue)] bg-[var(--aw-blue)]/5 rounded-r overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        {op.impact && (
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--aw-text-2)] shrink-0 w-14">
            {op.impact}
          </span>
        )}
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-blue)]/15 text-[var(--aw-blue)] shrink-0">
          {op.phase}
        </span>
        <span className="text-xs font-medium text-[var(--aw-text-0)] flex-1">{op.title}</span>
        {op.sourceDocument && (
          <span
            className="text-[9px] text-[var(--aw-text-4)] font-mono shrink-0 truncate max-w-[140px]"
            title={op.sourceEvidence ? `${op.sourceDocument} — ${op.sourceEvidence}` : op.sourceDocument}
          >
            {op.sourceDocument}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2.5 space-y-3 border-t border-[var(--aw-bg-2)]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-text-3)] mb-1">This skill contributes today</div>
              <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{op.currentContribution}</div>
            </div>
            <div className="rounded border border-[var(--aw-green)]/25 bg-[var(--aw-green)]/5 p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-green)] mb-1">After this skill&apos;s growth opportunities</div>
              <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{op.afterSkillImprovements}</div>
            </div>
          </div>

          <div className="rounded border border-[var(--aw-orange-bright)]/25 bg-[var(--aw-orange-bright)]/5 p-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-orange-bright)] mb-1">Remaining phase gap</div>
            <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{op.remainingGap}</div>
          </div>

          {op.sourceEvidence && <Field label="Source evidence">{op.sourceEvidence}</Field>}
          <Field label="Why this skill can't own it">{op.whyOutOfScope}</Field>
          <CalloutField label="Recommended next capability">{op.recommendedNextCapability}</CalloutField>
        </div>
      )}
    </div>
  );
}
