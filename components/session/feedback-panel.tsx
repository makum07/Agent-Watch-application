'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, Trash2, Zap, Loader2, ChevronDown, ChevronRight,
  MessageSquare, AlertCircle, Pencil, Check, FileText, RotateCcw,
  FileCode2, Clock, ShieldAlert, ShieldCheck, ListChecks,
} from 'lucide-react';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { FEEDBACK_CATEGORIES, type FeedbackCategory, type FileChange, type StreamEntry } from '@/types/feedback';
import type { SessionEvent, ClientMessage } from '@/types/events';
import { getAgentDisplay, resolveAgentById } from '@/lib/agent-display';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import {
  CollapsibleStreamLog,
  FileContentViewer,
  DiffLines,
} from '@/components/shared/collapsible-stream-log';
import { ModelSelect } from '@/components/shared/model-select';
import { StopButton } from '@/components/shared/stop-button';
import { MetaChip, CycleSectionHeader } from '@/components/shared/cycle-section';
import { cn, formatDuration } from '@/lib/utils';
import type { ImprovementCycle } from '@/types/feedback';

interface FeedbackPanelProps {
  sessionId: string;
  onClose: () => void;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  applying:  { label: 'Applying…', color: 'var(--aw-blue)' },
  completed: { label: 'Completed', color: 'var(--aw-green)' },
  failed:    { label: 'Failed',    color: 'var(--aw-red-bright)' },
  cancelled: { label: 'Cancelled', color: 'var(--aw-text-3)' },
  rewound:   { label: 'Rewound',   color: 'var(--aw-text-3)' },
};

export function FeedbackPanel({ sessionId, onClose }: FeedbackPanelProps) {
  const {
    items, cycles, isLoading, isApplying, isStopping, lastError, lastCycle,
    streamEntries, pendingApprovals, model,
    loadFeedback, loadCycles, deleteFeedback, updateFeedback,
    previewPrompt, applyImprovements, stopImprovements, setModel, rewindCycle, deleteCycle, clearRewoundCycles,
    clearError, handleStreamEvent,
  } = useFeedbackStore();
  const agentMap = useSessionStore(s => s.agentMap);

  // WebSocket: receive stream events and send approval responses
  const onWsEvent = useCallback((event: SessionEvent) => {
    if (
      event.type === 'improvement_stream_event' ||
      event.type === 'improvement_permission_request' ||
      event.type === 'improvement_permission_resolved' ||
      event.type === 'improvement_started' ||
      event.type === 'improvement_complete' ||
      event.type === 'improvement_failed'
    ) {
      handleStreamEvent(event);
    }
  }, [handleStreamEvent]);

  const { send: wsSend } = useWebSocket(onWsEvent);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'feedback' | 'history'>('feedback');

  // Which cycle is inline-expanded in the history list
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);

  // Apply flow
  const [applyStep, setApplyStep] = useState<'idle' | 'loading-preview' | 'editing-prompt' | 'applying'>('idle');
  const [promptDraft, setPromptDraft] = useState('');
  const [rewindFromCycle, setRewindFromCycle] = useState<number | null>(null);
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'edit'>('preview');
  const [skipPermissions, setSkipPermissions] = useState(false);

  // Rewind confirmation
  const [rewindConfirm, setRewindConfirm] = useState<ImprovementCycle | null>(null);
  const [isRewinding, setIsRewinding] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState<FeedbackCategory>('other');
  const [showEditCatMenu, setShowEditCatMenu] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadFeedback(sessionId); loadCycles(sessionId); }, [sessionId]);

  // Auto-expand the latest non-rewound cycle when history loads
  useEffect(() => {
    if (expandedCycleId) return;
    const latest = cycles.find(c => c.status !== 'rewound');
    if (latest) setExpandedCycleId(latest.id);
  }, [cycles.length]);

  // Switch to history and expand when a new cycle is created
  useEffect(() => {
    if (!lastCycle) return;
    setActiveTab('history');
    setExpandedCycleId(lastCycle.id);
  }, [lastCycle?.id]);

  // Poll while any cycle is applying
  const hasApplying = cycles.some(c => c.status === 'applying');
  const applyingCycleId = cycles.find(c => c.status === 'applying')?.id ?? null;
  useEffect(() => {
    if (!hasApplying) return;
    const t = setInterval(() => loadCycles(sessionId), 3000);
    return () => clearInterval(t);
  }, [hasApplying, sessionId]);

  useEffect(() => {
    if (editingId) editTextareaRef.current?.focus();
  }, [editingId]);

  // Group feedback items by agent
  const byAgent = new Map<string, typeof items>();
  for (const item of items) {
    if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, []);
    byAgent.get(item.agentId)!.push(item);
  }
  const catCounts = new Map<string, number>();
  for (const item of items) catCounts.set(item.category, (catCounts.get(item.category) ?? 0) + 1);
  const topCats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const rewoundCount = cycles.filter(c => c.status === 'rewound').length;
  // Latest cycle that is not rewound (the "current" state)
  const latestActiveCycleId = cycles.find(c => c.status !== 'rewound')?.id ?? null;

  async function handlePreview() {
    setApplyStep('loading-preview');
    setRewindFromCycle(null);
    const p = await previewPrompt(sessionId);
    if (p) { setPromptDraft(p); setPromptViewMode('preview'); setApplyStep('editing-prompt'); }
    else setApplyStep('idle');
  }

  async function handleApply() {
    setApplyStep('applying');
    const cycle = await applyImprovements(sessionId, promptDraft, skipPermissions);
    if (cycle) setExpandedCycleId(cycle.id);
    setApplyStep('idle');
    setRewindFromCycle(null);
  }

  function handleRewind(cycle: ImprovementCycle) {
    setRewindConfirm(cycle);
  }

  async function confirmRewind() {
    if (!rewindConfirm) return;
    setIsRewinding(true);
    const result = await rewindCycle(sessionId, rewindConfirm.id);
    setIsRewinding(false);
    setRewindConfirm(null);
    if (!result.ok) {
      useFeedbackStore.setState({ lastError: result.error ?? 'Rewind failed' });
      return;
    }
    setPromptDraft(rewindConfirm.generatedPrompt);
    setRewindFromCycle(rewindConfirm.cycleNumber);
    setPromptViewMode('preview');
    setApplyStep('editing-prompt');
  }

  function startEdit(id: string, text: string, cat: FeedbackCategory) {
    setEditingId(id); setEditText(text); setEditCategory(cat); setShowEditCatMenu(false);
  }
  function cancelEdit() { setEditingId(null); setShowEditCatMenu(false); }
  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await updateFeedback(sessionId, id, { text: editText.trim(), category: editCategory });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col h-full bg-[var(--aw-bg-0)] border-l border-[var(--aw-bg-2)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
        <MessageSquare className="h-4 w-4 text-[var(--aw-blue)]" />
        <span className="text-sm font-semibold text-[var(--aw-text-0)] flex-1">Feedback Review</span>
        {items.length > 0 && (
          <span className="text-[10px] bg-[var(--aw-blue)]/15 text-[var(--aw-blue)] border border-[var(--aw-blue)]/30 px-1.5 py-0.5 rounded-full font-medium">
            {items.length}
          </span>
        )}
        <button onClick={onClose} className="p-1 rounded text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Apply mode — sticks for whatever "Apply Improvements" runs next */}
      <button
        role="switch"
        aria-checked={skipPermissions}
        onClick={() => setSkipPermissions(v => !v)}
        title={skipPermissions
          ? 'Switch back to reviewing each Edit/Write before it’s applied'
          : 'Switch to --dangerously-skip-permissions — no approval prompts, fully autonomous'}
        className={cn(
          'shrink-0 w-full flex items-center justify-between gap-3 px-3 py-2 border-b transition-colors',
          skipPermissions
            ? 'bg-[var(--aw-orange)]/10 border-[var(--aw-orange)]/30 hover:bg-[var(--aw-orange)]/15'
            : 'bg-[var(--aw-bg-1)] border-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-2)]/60',
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {skipPermissions
            ? <Zap className="h-3.5 w-3.5 text-[var(--aw-orange)] shrink-0" />
            : <Check className="h-3.5 w-3.5 text-[var(--aw-text-2)] shrink-0" />}
          <span className={cn('text-xs font-semibold truncate', skipPermissions ? 'text-[var(--aw-orange)]' : 'text-[var(--aw-text-1)]')}>
            {skipPermissions ? 'Skip permissions — fully autonomous' : 'Review edits before applying'}
          </span>
        </span>
        <span
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            skipPermissions ? 'bg-[var(--aw-orange)]' : 'bg-[var(--aw-bg-2)]',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
              skipPermissions ? 'translate-x-[18px]' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>

      {/* Model — sticks for whatever "Apply Improvements" runs next */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
        <span className="text-xs font-medium text-[var(--aw-text-2)]">Model</span>
        <ModelSelect value={model} onChange={setModel} disabled={isApplying || hasApplying} />
      </div>

      {/* Tab rail */}
      <div className="shrink-0 flex border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
        {(['feedback', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors border-b-2',
              activeTab === tab
                ? 'text-[var(--aw-blue)] border-[var(--aw-blue)]'
                : 'text-[var(--aw-text-2)] border-transparent hover:text-[var(--aw-text-0)]',
            )}
          >
            {tab === 'feedback'
              ? 'Feedback'
              : `History${cycles.length > 0 ? ` (${cycles.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {lastError && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[var(--aw-red-bright)]/10 border-b border-[var(--aw-red-bright)]/30">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--aw-red-bright)] shrink-0" />
          <p className="text-[11px] text-[var(--aw-red-bright)] flex-1 truncate">{lastError}</p>
          <button onClick={clearError} className="text-[11px] text-[var(--aw-red-bright)] hover:text-[var(--aw-diff-del-text)] shrink-0">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {applyStep === 'editing-prompt' ? (
          /* ── Prompt editor — takes over the full content area ── */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Editor context bar */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
              {rewindFromCycle !== null ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 text-[var(--aw-orange)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--aw-text-0)] flex-1">
                    Rewind Cycle #{rewindFromCycle} — Edit &amp; Re-apply
                  </span>
                </>
              ) : (
                <>
                  <FileText className="h-3.5 w-3.5 text-[var(--aw-blue)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--aw-text-0)] flex-1">Review &amp; Edit Prompt</span>
                </>
              )}
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
            {/* Content: rendered preview or raw textarea */}
            {promptViewMode === 'preview' ? (
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <MarkdownRenderer content={promptDraft} size="sm" />
              </div>
            ) : (
              <textarea
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                className="flex-1 w-full px-3 py-2.5 bg-[var(--aw-bg-0)] text-[11px] text-[var(--aw-text-1)] font-mono leading-relaxed focus:outline-none resize-none border-0"
                placeholder="Improvement prompt will appear here…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleApply();
                  if (e.key === 'Escape') { setApplyStep('idle'); setRewindFromCycle(null); }
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
          {activeTab === 'feedback' ? (
          isLoading ? (
            <div className="flex items-center justify-center h-32 text-[var(--aw-text-2)]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--aw-text-4)] py-16">
              <MessageSquare className="h-8 w-8 opacity-30" />
              <div className="text-center px-4">
                <p className="text-xs font-medium text-[var(--aw-text-2)]">No feedback collected yet</p>
                <p className="text-[11px] mt-1 leading-relaxed">
                  Open the <strong className="text-[var(--aw-text-1)]">Feedback</strong> tab in any agent pane to add notes while reviewing
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] rounded p-2.5">
                  <div className="text-lg font-bold text-[var(--aw-text-0)]">{items.length}</div>
                  <div className="text-[11px] text-[var(--aw-text-2)]">Total items</div>
                </div>
                <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] rounded p-2.5">
                  <div className="text-lg font-bold text-[var(--aw-text-0)]">{byAgent.size}</div>
                  <div className="text-[11px] text-[var(--aw-text-2)]">Agents reviewed</div>
                </div>
              </div>

              {topCats.length > 0 && (
                <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] rounded divide-y divide-[var(--aw-bg-2)]">
                  <div className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide px-2.5 pt-2 pb-1.5">By Category</div>
                  {topCats.map(([cat, count]) => {
                    const meta = FEEDBACK_CATEGORIES.find(c => c.value === cat);
                    return (
                      <div key={cat} className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? 'var(--aw-text-2)' }} />
                        <span className="text-[11px] text-[var(--aw-text-1)] flex-1 truncate">{meta?.label ?? cat}</span>
                        <span className="text-[11px] text-[var(--aw-text-2)] tabular-nums shrink-0">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* By agent with inline edit */}
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide">By Agent</div>
                {Array.from(byAgent.entries()).map(([agentId, agentItems]) => {
                  const agent = resolveAgentById(agentMap, agentId);
                  const { name } = agent ? getAgentDisplay(agent) : { name: agentItems[0]?.agentName || agentId.slice(0, 8) };
                  const isOpen = !collapsed.has(agentId);
                  return (
                    <div key={agentId} className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] rounded overflow-hidden">
                      <button
                        onClick={() => setCollapsed(s => { const n = new Set(s); n.has(agentId) ? n.delete(agentId) : n.add(agentId); return n; })}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--aw-bg-2)] transition-colors text-left"
                      >
                        {isOpen
                          ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-2)] shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-[var(--aw-text-2)] shrink-0" />}
                        <span className="text-xs font-medium text-[var(--aw-text-0)] flex-1 truncate">{name}</span>
                        <span className="text-[10px] text-[var(--aw-text-2)] shrink-0">{agentItems.length}</span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-[var(--aw-bg-2)] divide-y divide-[var(--aw-bg-2)]">
                          {agentItems.map(item => {
                            const cat = FEEDBACK_CATEGORIES.find(c => c.value === item.category);
                            const isEditing = editingId === item.id;

                            if (isEditing) {
                              const ec = FEEDBACK_CATEGORIES.find(c => c.value === editCategory)!;
                              return (
                                <div key={item.id} className="px-3 py-2 space-y-1.5 bg-[var(--aw-bg-0)]/60">
                                  <div className="relative">
                                    <button
                                      onClick={() => setShowEditCatMenu(v => !v)}
                                      className="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-[var(--aw-bg-2)] border border-[var(--aw-bg-3)] text-[10px]"
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ec.color }} />
                                        <span style={{ color: ec.color }}>{ec.label}</span>
                                      </div>
                                      <ChevronDown className="h-2.5 w-2.5 text-[var(--aw-text-2)]" />
                                    </button>
                                    {showEditCatMenu && (
                                      <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded shadow-xl overflow-hidden">
                                        {FEEDBACK_CATEGORIES.map(c => (
                                          <button
                                            key={c.value}
                                            onClick={() => { setEditCategory(c.value); setShowEditCatMenu(false); }}
                                            className={cn('w-full flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-[var(--aw-bg-2)] text-left', editCategory === c.value && 'bg-[var(--aw-bg-2)]')}
                                          >
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                                            <span style={{ color: c.color }}>{c.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <textarea
                                    ref={editTextareaRef}
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    rows={2}
                                    className="w-full px-2 py-1 rounded bg-[var(--aw-bg-2)] border border-[var(--aw-bg-3)] text-[11px] text-[var(--aw-text-0)] focus:outline-none focus:border-[var(--aw-blue)]/50 resize-none"
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(item.id);
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => saveEdit(item.id)} disabled={!editText.trim()}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] disabled:opacity-40 text-white text-[10px] transition-colors"
                                    >
                                      <Check className="h-2.5 w-2.5" /> Save
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] text-[10px] transition-colors"
                                    >
                                      <X className="h-2.5 w-2.5" /> Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={item.id} className="group flex items-start gap-2 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <span
                                    className="inline-block text-[9px] px-1 py-0.5 rounded font-medium mb-1"
                                    style={{ color: cat?.color ?? 'var(--aw-text-2)', backgroundColor: `${cat?.color ?? 'var(--aw-text-2)'}18` }}
                                  >
                                    {cat?.label ?? item.category}
                                  </span>
                                  <p className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{item.text}</p>
                                </div>
                                <div className="flex gap-0.5 shrink-0 mt-0.5">
                                  <button
                                    onClick={() => startEdit(item.id, item.text, item.category as FeedbackCategory)}
                                    className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-blue)] hover:bg-[var(--aw-blue)]/10 transition-colors" title="Edit"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    onClick={() => deleteFeedback(sessionId, item.id)}
                                    className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-red-bright)] hover:bg-[var(--aw-red-bright)]/10 transition-colors" title="Delete"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* ── History tab ── */
          <div className="p-3 space-y-3">
            {/* History header */}
            {cycles.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--aw-text-4)]">
                  {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}
                </span>
                {rewoundCount > 0 && (
                  <button
                    onClick={() => clearRewoundCycles(sessionId)}
                    className="flex items-center gap-1 text-[10px] text-[var(--aw-text-4)] hover:text-[var(--aw-red-bright)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--aw-red-bright)]/10"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Clear {rewoundCount} rewound
                  </button>
                )}
              </div>
            )}

            {cycles.map(cycle => (
              <CycleCard
                key={cycle.id}
                cycle={cycle}
                sessionId={sessionId}
                isLatest={cycle.id === latestActiveCycleId}
                isExpanded={expandedCycleId === cycle.id}
                onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
                onRewind={() => handleRewind(cycle)}
                onDelete={() => deleteCycle(sessionId, cycle.id)}
                streamEntries={streamEntries}
                pendingApprovals={pendingApprovals}
                onApprove={(requestId) => wsSend({ type: 'permission_response', sessionId, cycleId: cycle.id, requestId, approved: true })}
                onDeny={(requestId) => wsSend({ type: 'permission_response', sessionId, cycleId: cycle.id, requestId, approved: false })}
              />
            ))}

            {cycles.length === 0 && (
              <div className="text-center py-12 text-[var(--aw-text-4)] text-xs">No improvement cycles yet</div>
            )}
          </div>
        )}
          </div>
        )}
      </div>

      {/* Rewind confirmation overlay */}
      {rewindConfirm && (
        <div className="shrink-0 border-t border-[var(--aw-orange)]/40 bg-[var(--aw-orange)]/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-[var(--aw-orange)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-medium text-[var(--aw-text-0)]">Rewind Cycle #{rewindConfirm.cycleNumber}?</p>
              <p className="text-[10px] text-[var(--aw-text-2)] mt-0.5 leading-relaxed">
                The session JSONL will be truncated to the snapshot recorded before this
                cycle ran — removing its messages exactly as Claude Code&apos;s{' '}
                <code className="bg-[var(--aw-bg-2)] px-1 rounded font-mono">/rewind</code> does.
                The editor will then open so you can refine the prompt and re-apply.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmRewind}
              disabled={isRewinding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--aw-orange)] hover:bg-[var(--aw-orange)]/80 disabled:opacity-40 text-white text-xs font-medium transition-colors"
            >
              {isRewinding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              {isRewinding ? 'Rewinding…' : 'Confirm Rewind'}
            </button>
            <button
              onClick={() => setRewindConfirm(null)}
              disabled={isRewinding}
              className="px-3 py-1.5 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
        {applyStep === 'editing-prompt' ? (
          /* Slim action bar — editor lives in the content area above */
          <div className="px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] text-[var(--aw-text-3)]">
              Applying with <span className={skipPermissions ? 'text-[var(--aw-orange)]' : 'text-[var(--aw-blue)]'}>
                {skipPermissions ? 'permissions skipped' : 'edit review'}
              </span> — change this in &ldquo;Apply mode&rdquo; above.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApply}
                disabled={!promptDraft.trim() || isApplying || hasApplying}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-[var(--aw-blue-action)] hover:bg-[var(--aw-blue-action-hover)] disabled:opacity-40 text-white text-xs font-semibold transition-colors"
              >
                {isApplying
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Applying…</>
                  : <><Zap className="h-3 w-3" /> Apply Improvements</>}
              </button>
              <button
                onClick={() => { setApplyStep('idle'); setRewindFromCycle(null); }}
                className="px-3 py-2 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:border-[var(--aw-text-4)] text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={items.length === 0 || applyStep !== 'idle' || hasApplying}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded bg-[var(--aw-blue-action)] hover:bg-[var(--aw-blue-action-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {applyStep === 'loading-preview' || applyStep === 'applying' || hasApplying
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Zap className="h-4 w-4" />}
              {applyStep === 'loading-preview' ? 'Generating prompt…'
                : applyStep === 'applying' || hasApplying ? 'A cycle is already running…'
                : <>Apply Improvements{items.length > 0 && <span className="text-xs opacity-75 ml-1">({items.length})</span>}</>}
            </button>
            {hasApplying && applyingCycleId && (
              <StopButton onClick={() => stopImprovements(sessionId, applyingCycleId)} stopping={isStopping} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── CycleCard ──────────────────────────────────────────────────────────────────

interface CycleCardProps {
  cycle: ImprovementCycle;
  sessionId: string;
  isLatest: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRewind: () => void;
  onDelete: () => void;
  streamEntries: StreamEntry[];
  pendingApprovals: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}

function CycleCard({ cycle, sessionId, isLatest, isExpanded, onToggle, onRewind, onDelete, streamEntries, pendingApprovals, onApprove, onDeny }: CycleCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const s = STATUS_META[cycle.status] ?? STATUS_META.completed;
  const canExpand = cycle.status !== 'rewound';
  const canRewind = cycle.status === 'completed' || cycle.status === 'failed';

  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // At-a-glance stats so the collapsed row is informative on its own —
  // you shouldn't have to expand a cycle just to see whether it did anything.
  const touchedPaths = new Set<string>();
  for (const c of cycle.fileChanges ?? []) touchedPaths.add(c.filePath);
  for (const e of cycle.streamEntries ?? []) {
    if (e.kind === 'tool_use' && e.toolInput?.file_path) touchedPaths.add(String(e.toolInput.file_path));
  }
  const totalAdd = (cycle.fileChanges ?? []).reduce((sum, c) => sum + c.additions, 0);
  const totalDel = (cycle.fileChanges ?? []).reduce((sum, c) => sum + c.deletions, 0);
  const durationMs = cycle.completedAt
    ? new Date(cycle.completedAt).getTime() - new Date(cycle.createdAt).getTime()
    : null;

  const hasPrompt = cycle.generatedPrompt.length > 0;
  const hasFileChanges = !!cycle.fileChanges?.length;
  const hasTouchedFiles = !!cycle.streamEntries?.length;
  const hasFallbackRefs = !hasFileChanges && !hasTouchedFiles && !!cycle.claudeResponse;

  return (
    <div
      className={cn(
        'rounded border overflow-hidden transition-colors',
        cycle.status === 'rewound'
          ? 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)] opacity-50'
          : isLatest
            ? 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] ring-1 ring-[var(--aw-green)]/20'
            : 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]',
      )}
    >
      {/* ── Header — actions reveal on hover instead of a permanent extra row ── */}
      <div
        className={cn(
          'group',
          canExpand && 'cursor-pointer hover:bg-[var(--aw-bg-2)]/30 transition-colors',
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="text-[11px] font-bold text-[var(--aw-text-0)] shrink-0">#{cycle.cycleNumber}</span>

          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{ color: s.color, background: `${s.color}18` }}
          >
            {s.label}
          </span>

          {isLatest && (
            <span className="text-[9px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--aw-green)' }}>
              Current
            </span>
          )}

          <span className="flex-1" />

          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            {canRewind && (
              <button
                onClick={e => { e.stopPropagation(); onRewind(); }}
                className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-orange)] hover:bg-[var(--aw-orange)]/10 transition-colors"
                title="Rewind — restore conversation to before this cycle"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-red-bright)] hover:bg-[var(--aw-red-bright)]/10 transition-colors"
              title="Delete this cycle record"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>

          <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{date}</span>

          {canExpand && (
            isExpanded
              ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
              : <ChevronRight className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
          )}
        </div>

        {/* Meta strip — glanceable summary without expanding */}
        {canExpand && (
          <div className="flex items-center gap-3 px-3 pb-2 pt-1 text-[10px] text-[var(--aw-text-3)]">
            <MetaChip icon={<ListChecks />}>
              {cycle.feedbackIds.length} feedback item{cycle.feedbackIds.length !== 1 ? 's' : ''}
            </MetaChip>
            {touchedPaths.size > 0 && (
              <MetaChip icon={<FileCode2 />}>
                {touchedPaths.size} file{touchedPaths.size !== 1 ? 's' : ''}
              </MetaChip>
            )}
            {(totalAdd > 0 || totalDel > 0) && (
              <span className="flex items-center gap-1.5 font-mono shrink-0">
                {totalAdd > 0 && <span className="text-[var(--aw-green)]">+{totalAdd}</span>}
                {totalDel > 0 && <span className="text-[var(--aw-red-bright)]">−{totalDel}</span>}
              </span>
            )}
            {durationMs !== null && durationMs > 0 && (
              <MetaChip icon={<Clock />}>{formatDuration(durationMs)}</MetaChip>
            )}
            <span className="flex-1" />
            <MetaChip
              icon={cycle.permissionMode === 'skip' ? <ShieldAlert /> : <ShieldCheck />}
              color={cycle.permissionMode === 'skip' ? 'var(--aw-orange)' : undefined}
            >
              {cycle.permissionMode === 'skip' ? 'Permissions skipped' : 'Edit review'}
            </MetaChip>
          </div>
        )}
      </div>

      {/* ── Expanded content — one consistent section shape throughout ── */}
      {isExpanded && canExpand && (
        <div className="border-t border-[var(--aw-bg-2)] divide-y divide-[var(--aw-bg-2)]">
          {hasPrompt && (
            <div>
              <CycleSectionHeader
                icon={<FileText />}
                label="Generated Prompt"
                open={showPrompt}
                onToggle={() => setShowPrompt(v => !v)}
                trailing={`${cycle.generatedPrompt.length.toLocaleString()} chars`}
              />
              {showPrompt && (
                <div className="px-3 pb-3 bg-[var(--aw-bg-0)]/40">
                  <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap max-h-40 overflow-y-auto font-mono bg-[var(--aw-bg-0)] p-2.5 rounded border border-[var(--aw-bg-2)] leading-relaxed">
                    {cycle.generatedPrompt}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Files touched — extracted from stream entries (reads + writes) */}
          {hasTouchedFiles && (
            <TouchedFilesSummary entries={cycle.streamEntries!} sessionId={sessionId} />
          )}

          {/* File changes — structured diff, the primary payload of a cycle */}
          {hasFileChanges && (
            <FileDiffViewer changes={cycle.fileChanges!} sessionId={sessionId} />
          )}

          {/* Fallback: extract file references from response when no structured data */}
          {hasFallbackRefs && (
            <ReferencedFiles sessionId={sessionId} responseText={cycle.claudeResponse!} />
          )}

          {/* Response — collapsible stream log (live or persisted) */}
          <CycleResponseView
            cycle={cycle}
            sessionId={sessionId}
            streamEntries={streamEntries}
            pendingApprovals={pendingApprovals}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </div>
      )}
    </div>
  );
}

// ── FileRow — shared row shape for any "path + badges, expand to view" list ──
// (Files Touched, Files Referenced). Filename is the primary label; the full
// path is a muted, independently-truncated subtitle so long paths never blow
// out the row's layout the way a single truncate-flex-1 span can.

function FileRow({
  path, isExpanded, onToggle, sessionId, accentColor, badges,
}: {
  path: string;
  isExpanded: boolean;
  onToggle: () => void;
  sessionId: string;
  accentColor: string;
  badges?: React.ReactNode;
}) {
  const fileName = path.split(/[/\\]/).pop() ?? path;

  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: `${accentColor}30` }}>
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--aw-bg-1)] transition-colors text-left min-w-0"
        onClick={onToggle}
        title={path}
      >
        <FileCode2 className="h-3 w-3 shrink-0" style={{ color: accentColor }} />
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-medium text-[var(--aw-text-0)] truncate">{fileName}</span>
          {path !== fileName && (
            <span className="block text-[9px] font-mono text-[var(--aw-text-4)] truncate">{path}</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">{badges}</span>
        <ChevronRight className={cn('h-2.5 w-2.5 text-[var(--aw-text-4)] shrink-0 transition-transform', isExpanded && 'rotate-90')} />
      </button>
      {isExpanded && (
        <FileContentViewer sessionId={sessionId} filePath={path} />
      )}
    </div>
  );
}

// ── TouchedFilesSummary ──────────────────────────────────────────────────────

function TouchedFilesSummary({ entries, sessionId }: { entries: StreamEntry[]; sessionId: string }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const files: { path: string; toolName: string; approved?: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'tool_use' && e.toolInput?.file_path) {
      const fp = String(e.toolInput.file_path);
      if (!seen.has(fp)) {
        seen.add(fp);
        files.push({ path: fp, toolName: e.toolName ?? 'Unknown' });
      }
    }
    // Approval results logged as tool_result with filePath
    const eAny = e as unknown as Record<string, unknown>;
    if (e.kind === 'tool_result' && eAny.filePath) {
      const fp = String(eAny.filePath);
      const approved = eAny.approved as boolean | undefined;
      if (!seen.has(fp)) {
        seen.add(fp);
        files.push({ path: fp, toolName: String(eAny.toolName ?? 'Edit'), approved });
      }
    }
  }

  if (files.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-[var(--aw-text-1)]">
        <FileCode2 className="h-3 w-3 text-[var(--aw-text-3)]" />
        Files Touched
        <span className="text-[10px] text-[var(--aw-text-4)] font-normal">({files.length})</span>
      </div>
      <div className="space-y-1 px-3 pb-3">
        {files.map(f => {
          const isWrite = f.toolName === 'Edit' || f.toolName === 'Write';
          const color = isWrite ? 'var(--aw-orange)' : 'var(--aw-blue-light)';

          return (
            <FileRow
              key={f.path}
              path={f.path}
              sessionId={sessionId}
              accentColor={color}
              isExpanded={expandedFile === f.path}
              onToggle={() => setExpandedFile(expandedFile === f.path ? null : f.path)}
              badges={
                <>
                  <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0" style={{ color, background: `${color}15` }}>
                    {f.toolName}
                  </span>
                  {f.approved !== undefined && (
                    <span className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded shrink-0',
                      f.approved ? 'text-[var(--aw-green)] bg-[var(--aw-green)]/10' : 'text-[var(--aw-red-bright)] bg-[var(--aw-red-bright)]/10',
                    )}>
                      {f.approved ? 'approved' : 'denied'}
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ── CycleResponseView (collapsible wrapper for stream log / markdown) ────────

function CycleResponseView({
  cycle,
  sessionId,
  streamEntries,
  pendingApprovals,
  onApprove,
  onDeny,
}: {
  cycle: ImprovementCycle;
  sessionId: string;
  streamEntries: StreamEntry[];
  pendingApprovals: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}) {
  const [showLog, setShowLog] = useState(cycle.status === 'applying');
  const hasStreamLog = (cycle.streamEntries && cycle.streamEntries.length > 0) || cycle.status === 'applying';
  const label = cycle.status === 'applying' ? 'Live Stream' : hasStreamLog ? 'Activity Log' : 'Response';
  const entryCount = cycle.status === 'applying'
    ? streamEntries.length
    : cycle.streamEntries?.length ?? 0;

  return (
    <div>
      <CycleSectionHeader
        icon={cycle.status === 'applying' ? <Loader2 className="animate-spin" /> : <MessageSquare />}
        label={label}
        open={showLog}
        onToggle={() => setShowLog(v => !v)}
        trailing={entryCount > 0 ? `${entryCount} event${entryCount !== 1 ? 's' : ''}` : undefined}
      />
      {showLog && (
        <div className="px-3 pb-3 bg-[var(--aw-bg-0)]/40">
          {cycle.status === 'applying' ? (
            <CollapsibleStreamLog
              entries={streamEntries}
              sessionId={sessionId}
              pendingApprovals={pendingApprovals}
              onApprove={onApprove}
              onDeny={onDeny}
              isLive
            />
          ) : cycle.streamEntries && cycle.streamEntries.length > 0 ? (
            <CollapsibleStreamLog
              entries={cycle.streamEntries}
              sessionId={sessionId}
            />
          ) : cycle.claudeResponse ? (
            <div className="max-h-[420px] overflow-y-auto pr-0.5">
              <MarkdownRenderer content={cycle.claudeResponse} size="sm" />
            </div>
          ) : (
            <p className="text-[11px] text-[var(--aw-text-4)]">No response captured</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ReferencedFiles (fallback for cycles without stream entries) ──────────────

function extractFilePathsFromText(text: string): string[] {
  const paths = new Set<string>();
  // Match file paths with extensions (e.g., src/foo/bar.ts, .claude/skills/agent.md)
  const fileRegex = /(?:^|\s|`|"|\()([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,10})(?:\s|`|"|,|\)|$)/gm;
  let m;
  while ((m = fileRegex.exec(text)) !== null) {
    const fp = m[1].trim();
    // Filter out URLs and very short matches
    if (!fp.includes('://') && fp.length > 3 && !fp.startsWith('http')) {
      paths.add(fp);
    }
  }
  return Array.from(paths);
}

function ReferencedFiles({ sessionId, responseText }: { sessionId: string; responseText: string }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const filePaths = extractFilePathsFromText(responseText);

  if (filePaths.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-[var(--aw-text-1)]">
        <FileCode2 className="h-3 w-3 text-[var(--aw-text-3)]" />
        Files Referenced
        <span className="text-[10px] text-[var(--aw-text-4)] font-normal">({filePaths.length})</span>
      </div>
      <div className="space-y-1 px-3 pb-3">
        {filePaths.map(fp => (
          <FileRow
            key={fp}
            path={fp}
            sessionId={sessionId}
            accentColor="var(--aw-blue-light)"
            isExpanded={expandedFile === fp}
            onToggle={() => setExpandedFile(expandedFile === fp ? null : fp)}
          />
        ))}
      </div>
    </div>
  );
}

// ── FileDiffViewer ─────────────────────────────────────────────────────────────

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
    py: 'py', go: 'go', rs: 'rs', rb: 'rb',
    md: 'md', mdx: 'md', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    css: 'css', scss: 'scss', html: 'html', sh: 'sh',
  };
  return map[ext] || ext || 'txt';
}

function FileDiffViewer({ changes, sessionId }: { changes: FileChange[]; sessionId: string }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [fileViewMode, setFileViewMode] = useState<Record<string, 'diff' | 'file'>>({});

  const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
  const totalDel = changes.reduce((s, c) => s + c.deletions, 0);

  const toggle = (fp: string) =>
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(fp) ? next.delete(fp) : next.add(fp);
      return next;
    });

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-[var(--aw-text-1)]">
        <FileCode2 className="h-3 w-3 text-[var(--aw-text-3)]" />
        Files Changed
        <span className="text-[10px] text-[var(--aw-text-4)] font-normal">({changes.length})</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono">
          {totalAdd > 0 && <span className="text-[var(--aw-green)]">+{totalAdd}</span>}
          {totalDel > 0 && <span className="text-[var(--aw-red-bright)]">−{totalDel}</span>}
        </span>
      </div>

      {/* Per-file rows */}
      <div className="mx-3 mb-3 rounded border border-[var(--aw-bg-2)] divide-y divide-[var(--aw-bg-2)] overflow-hidden">
        {changes.map(fc => {
          const isExpanded = expandedFiles.has(fc.filePath);
          const fileName = fc.filePath.split(/[/\\]/).pop() ?? fc.filePath;
          const lang = detectLang(fc.filePath);
          const typeColor =
            fc.type === 'create' ? 'var(--aw-green)' :
            fc.type === 'delete' ? 'var(--aw-red-bright)' : 'var(--aw-orange)';
          const typeBg =
            fc.type === 'create' ? 'var(--aw-green)' :
            fc.type === 'delete' ? 'var(--aw-red-bright)' : 'var(--aw-orange)';
          const typeLabel =
            fc.type === 'create' ? '+ Create' :
            fc.type === 'delete' ? '✕ Delete' : '✎ Modify';

          return (
            <div key={fc.filePath}>
              {/* File header row */}
              <button
                onClick={() => toggle(fc.filePath)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-[var(--aw-bg-1)] transition-colors text-left min-w-0"
              >
                {isExpanded
                  ? <ChevronDown className="h-2.5 w-2.5 text-[var(--aw-text-4)] shrink-0" />
                  : <ChevronRight className="h-2.5 w-2.5 text-[var(--aw-text-4)] shrink-0" />}

                {/* Type badge */}
                <span
                  className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded border"
                  style={{ color: typeColor, borderColor: `${typeBg}40`, backgroundColor: `${typeBg}12` }}
                >
                  {typeLabel}
                </span>

                {/* File name + path subtitle */}
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-semibold text-[var(--aw-text-0)] truncate">{fileName}</span>
                  {!isExpanded && fc.filePath !== fileName && (
                    <span className="block text-[9px] font-mono text-[var(--aw-text-4)] truncate" title={fc.filePath}>
                      {fc.filePath}
                    </span>
                  )}
                </span>
                <span className="text-[9px] text-[var(--aw-text-4)] font-mono shrink-0">{lang}</span>

                {/* +/- stats */}
                <span className="shrink-0 flex items-center gap-1.5 font-mono text-[10px]">
                  {fc.additions > 0 && <span className="text-[var(--aw-green)]">+{fc.additions}</span>}
                  {fc.deletions > 0 && <span className="text-[var(--aw-red-bright)]">−{fc.deletions}</span>}
                </span>
              </button>

              {/* Expanded: diff or file view */}
              {isExpanded && (() => {
                const mode = fileViewMode[fc.filePath] ?? 'diff';
                return (
                  <div className="border-t border-[var(--aw-bg-2)]">
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--aw-bg-4)] border-b border-[var(--aw-bg-2)] min-w-0">
                      <span className="text-[9px] font-mono text-[var(--aw-text-4)] truncate flex-1 min-w-0" title={fc.filePath}>{fc.filePath}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setFileViewMode(prev => ({ ...prev, [fc.filePath]: mode === 'diff' ? 'file' : 'diff' })); }}
                        className={cn(
                          'text-[9px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                          mode === 'file'
                            ? 'text-[var(--aw-blue)] bg-[var(--aw-blue)]/10'
                            : 'text-[var(--aw-text-4)] hover:text-[var(--aw-text-2)]',
                        )}
                      >
                        <FileCode2 className="h-2.5 w-2.5" /> {mode === 'file' ? 'Diff' : 'View File'}
                      </button>
                    </div>
                    {mode === 'diff' ? (
                      fc.diff
                        ? <DiffLines diff={fc.diff} />
                        : <p className="px-3 py-2 text-[10px] text-[var(--aw-text-4)]">No diff available</p>
                    ) : (
                      <FileContentViewer sessionId={sessionId} filePath={fc.filePath} />
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

