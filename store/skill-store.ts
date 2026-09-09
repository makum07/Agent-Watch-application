'use client';

import { create } from 'zustand';
import type {
  SkillSummary,
  SkillDetailData,
  SkillAnalysisCycle,
  SkillContextFileSummary,
  ProjectContextFileSummary,
  SelfHealingMode,
} from '@/types/skills';
import type { SessionEvent, StreamEvent, ContentBlock } from '@/types/events';
import type { StreamEntry } from '@/types/feedback';
import { DEFAULT_CLAUDE_CLI_MODEL, type ClaudeCliModel } from '@/lib/claude-models';

// The skill-detail endpoint strips extractedText from contextFiles/
// projectContextFiles before sending to the browser (it can be large and
// the UI never needs it).
type ClientSkillDetailData = Omit<SkillDetailData, 'contextFiles' | 'projectContextFiles'> & {
  contextFiles: SkillContextFileSummary[];
  projectContextFiles: ProjectContextFileSummary[];
};

// Text documents return their extracted text; image attachments return a
// base64 data URL instead (see the attachments/[fileId] routes).
export type ViewedContextFile =
  | { filename: string; extractedText: string }
  | { filename: string; mimeType: string; dataUrl: string };

interface SkillStore {
  skills: SkillSummary[];
  selectedSkill: ClientSkillDetailData | null;
  analysisCycles: SkillAnalysisCycle[];
  // Independent of selectedSkill so project documents can be managed from
  // the skills list (project-level) without opening any specific skill.
  projectContextFiles: ProjectContextFileSummary[];
  isLoading: boolean;
  isSyncing: boolean;
  isAnalyzing: boolean;
  isStopping: boolean;
  isUploadingContext: boolean;
  isUploadingProjectContext: boolean;
  isLoadingProjectContext: boolean;
  lastError: string | null;
  sourceId: string | undefined;
  activeCycleId: string | null;
  model: ClaudeCliModel;

  streamEntries: StreamEntry[];

  setSourceId: (sourceId: string | undefined) => void;
  setModel: (model: ClaudeCliModel) => void;
  loadSkills: (project?: string) => Promise<void>;
  syncSkills: () => Promise<number>;
  loadSkillDetail: (skillId: string) => Promise<void>;
  updateSkillConfig: (skillId: string, updates: {
    selfHealingEnabled?: boolean;
    selfHealingMode?: SelfHealingMode;
    selfHealingThreshold?: number;
    description?: string;
  }) => Promise<void>;
  loadAnalysisCycles: (skillId: string) => Promise<void>;
  previewPrompt: (skillId: string) => Promise<string | null>;
  triggerAnalysis: (skillId: string, customPrompt?: string) => Promise<SkillAnalysisCycle | null>;
  stopAnalysis: (skillId: string) => Promise<void>;
  approveFixPrompt: (skillId: string, cycleId: string, fixPrompt?: string) => Promise<void>;
  deleteAnalysisCycle: (skillId: string, cycleId: string) => Promise<void>;
  uploadContextFile: (skillId: string, file: File) => Promise<boolean>;
  deleteContextFile: (skillId: string, fileId: string) => Promise<void>;
  viewContextFile: (skillId: string, fileId: string) => Promise<ViewedContextFile | null>;
  loadProjectContextFiles: (project: string) => Promise<void>;
  uploadProjectContextFile: (project: string, file: File) => Promise<boolean>;
  deleteProjectContextFile: (fileId: string) => Promise<void>;
  viewProjectContextFile: (fileId: string) => Promise<ViewedContextFile | null>;
  handleStreamEvent: (event: SessionEvent) => void;
  clearError: () => void;
  clearStream: () => void;
  reset: () => void;
}

let streamIdCounter = 0;

// Appends the active source (if any) as a query param, correctly whether
// the URL already has a `?` from another param (e.g. ?project=...) or not.
function withSource(url: string, sourceId: string | undefined): string {
  if (!sourceId) return url;
  return url + (url.includes('?') ? '&' : '?') + 'source=' + encodeURIComponent(sourceId);
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  selectedSkill: null,
  analysisCycles: [],
  projectContextFiles: [],
  isLoading: false,
  isSyncing: false,
  isAnalyzing: false,
  isStopping: false,
  isUploadingContext: false,
  isUploadingProjectContext: false,
  isLoadingProjectContext: false,
  lastError: null,
  sourceId: undefined,
  activeCycleId: null,
  model: DEFAULT_CLAUDE_CLI_MODEL,
  streamEntries: [],

  setSourceId: (sourceId) => set({ sourceId }),
  setModel: (model) => set({ model }),

  loadSkills: async (project?) => {
    set({ isLoading: true, lastError: null });
    try {
      const base = project ? `/api/v2/skills?project=${encodeURIComponent(project)}` : '/api/v2/skills';
      const url = withSource(base, get().sourceId);
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ skills: data.skills, isLoading: false });
    } catch (err) {
      set({ lastError: String(err), isLoading: false });
    }
  },

  syncSkills: async () => {
    set({ isSyncing: true, lastError: null });
    try {
      const res = await fetch(withSource('/api/v2/skills', get().sourceId), { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await get().loadSkills();
      set({ isSyncing: false });
      return data.synced;
    } catch (err) {
      set({ lastError: String(err), isSyncing: false });
      return 0;
    }
  },

  loadSkillDetail: async (skillId) => {
    set({ isLoading: true, lastError: null });
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ selectedSkill: data, isLoading: false });
    } catch (err) {
      set({ lastError: String(err), isLoading: false });
    }
  },

  updateSkillConfig: async (skillId, updates) => {
    set({ lastError: null });
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}`, get().sourceId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      await get().loadSkillDetail(skillId);
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  loadAnalysisCycles: async (skillId) => {
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}/analysis`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ analysisCycles: data.cycles });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  previewPrompt: async (skillId) => {
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}/analysis?preview=1`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.prompt as string;
    } catch (err) {
      set({ lastError: String(err) });
      return null;
    }
  },

  triggerAnalysis: async (skillId, customPrompt?) => {
    set({ isAnalyzing: true, lastError: null, streamEntries: [] });
    try {
      const body: Record<string, unknown> = { model: get().model };
      if (customPrompt) body.customPrompt = customPrompt;

      const res = await fetch(withSource(`/api/v2/skills/${skillId}/analysis`, get().sourceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const cycle = await res.json();
      set({ activeCycleId: cycle.id });
      return cycle;
    } catch (err) {
      set({ lastError: String(err), isAnalyzing: false });
      return null;
    }
  },

  stopAnalysis: async (skillId) => {
    const cycleId = get().activeCycleId;
    if (!cycleId) return;
    set({ isStopping: true });
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}/analysis/${cycleId}`, get().sourceId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      set({ lastError: String(err) });
    } finally {
      set({ isStopping: false });
    }
  },

  approveFixPrompt: async (skillId, cycleId, fixPrompt?) => {
    set({ isAnalyzing: true, lastError: null, activeCycleId: cycleId });
    try {
      const body: Record<string, unknown> = { model: get().model };
      if (fixPrompt) body.fixPrompt = fixPrompt;

      const res = await fetch(withSource(`/api/v2/skills/${skillId}/analysis/${cycleId}`, get().sourceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await get().loadAnalysisCycles(skillId);
    } catch (err) {
      set({ lastError: String(err), isAnalyzing: false });
    }
  },

  deleteAnalysisCycle: async (skillId, cycleId) => {
    try {
      await fetch(withSource(`/api/v2/skills/${skillId}/analysis/${cycleId}`, get().sourceId), { method: 'DELETE' });
      set(state => ({
        analysisCycles: state.analysisCycles.filter(c => c.id !== cycleId),
      }));
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  uploadContextFile: async (skillId, file) => {
    set({ isUploadingContext: true, lastError: null });
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(withSource(`/api/v2/skills/${skillId}/attachments`, get().sourceId), {
        method: 'POST',
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || await res.text());
      }
      await get().loadSkillDetail(skillId);
      set({ isUploadingContext: false });
      return true;
    } catch (err) {
      set({ lastError: String(err instanceof Error ? err.message : err), isUploadingContext: false });
      return false;
    }
  },

  deleteContextFile: async (skillId, fileId) => {
    try {
      await fetch(withSource(`/api/v2/skills/${skillId}/attachments/${fileId}`, get().sourceId), { method: 'DELETE' });
      set(state => ({
        selectedSkill: state.selectedSkill
          ? { ...state.selectedSkill, contextFiles: state.selectedSkill.contextFiles.filter(f => f.id !== fileId) }
          : state.selectedSkill,
      }));
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  viewContextFile: async (skillId, fileId) => {
    try {
      const res = await fetch(withSource(`/api/v2/skills/${skillId}/attachments/${fileId}`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (err) {
      set({ lastError: String(err) });
      return null;
    }
  },

  loadProjectContextFiles: async (project) => {
    set({ isLoadingProjectContext: true, lastError: null });
    try {
      const res = await fetch(withSource(`/api/v2/projects/attachments?project=${encodeURIComponent(project)}`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ projectContextFiles: data.files, isLoadingProjectContext: false });
    } catch (err) {
      set({ lastError: String(err), isLoadingProjectContext: false });
    }
  },

  uploadProjectContextFile: async (project, file) => {
    set({ isUploadingProjectContext: true, lastError: null });
    try {
      const body = new FormData();
      body.append('project', project);
      body.append('file', file);
      const res = await fetch(withSource('/api/v2/projects/attachments', get().sourceId), {
        method: 'POST',
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || await res.text());
      }
      await get().loadProjectContextFiles(project);
      set({ isUploadingProjectContext: false });
      return true;
    } catch (err) {
      set({ lastError: String(err instanceof Error ? err.message : err), isUploadingProjectContext: false });
      return false;
    }
  },

  deleteProjectContextFile: async (fileId) => {
    try {
      await fetch(withSource(`/api/v2/projects/attachments/${fileId}`, get().sourceId), { method: 'DELETE' });
      set(state => ({
        projectContextFiles: state.projectContextFiles.filter(f => f.id !== fileId),
      }));
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  viewProjectContextFile: async (fileId) => {
    try {
      const res = await fetch(withSource(`/api/v2/projects/attachments/${fileId}`, get().sourceId));
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (err) {
      set({ lastError: String(err) });
      return null;
    }
  },

  handleStreamEvent: (event: SessionEvent) => {
    if (event.type === 'skill_analysis_started') {
      set({ streamEntries: [], isAnalyzing: true });
      return;
    }

    if (event.type === 'skill_analysis_stream_event') {
      const streamEvent = (event as unknown as { event: StreamEvent }).event;
      const entries: StreamEntry[] = [];

      if (streamEvent.type === 'assistant') {
        const msg = streamEvent.message as { content?: ContentBlock[] };
        if (msg?.content) {
          for (const block of msg.content) {
            if ('text' in block && block.text) {
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'text',
                timestamp: Date.now(),
                text: block.text,
              });
            }
            if ('thinking' in block) {
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'thinking',
                timestamp: Date.now(),
                text: (block as { thinking: string }).thinking,
              });
            }
            if (block.type === 'tool_use') {
              const tu = block as { id: string; name: string; input: Record<string, unknown> };
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'tool_use',
                timestamp: Date.now(),
                toolName: tu.name,
                toolInput: tu.input,
                toolUseId: tu.id,
              });
            }
          }
        }
      }

      if (streamEvent.type === 'user') {
        const userMsg = streamEvent.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> };
        if (userMsg?.content) {
          for (const block of userMsg.content) {
            if (block.type === 'tool_result') {
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'tool_result',
                timestamp: Date.now(),
                toolUseId: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error ?? false,
              });
            }
          }
        }
      }

      // Confirms the model picker's choice actually took effect, and captures
      // this new one-shot session's own id (unlike the improvement loop,
      // this always starts a fresh session rather than resuming one) — both
      // come from the CLI's own init event.
      if (streamEvent.type === 'system' && streamEvent.subtype === 'init') {
        const resolvedModel = (streamEvent as { model?: string }).model;
        const cliSessionId = (streamEvent as { session_id?: string }).session_id;
        entries.push({
          id: `sk-${++streamIdCounter}`,
          kind: 'system',
          timestamp: Date.now(),
          text: `Session initialized (model: ${resolvedModel ?? 'unknown'}${cliSessionId ? `, session: ${cliSessionId}` : ''})`,
        });
        if (resolvedModel || cliSessionId) {
          const activeId = get().activeCycleId;
          set(s => ({
            analysisCycles: s.analysisCycles.map(c => c.id === activeId
              ? { ...c, model: resolvedModel ?? c.model, cliSessionId: cliSessionId ?? c.cliSessionId }
              : c),
          }));
        }
      }

      if (entries.length > 0) {
        set(state => ({ streamEntries: [...state.streamEntries, ...entries] }));
      }
      return;
    }

    if (event.type === 'skill_analysis_complete') {
      set({ isAnalyzing: false, activeCycleId: null });
      const skillId = (event as unknown as { skillId: string }).skillId;
      get().loadAnalysisCycles(skillId);
      get().loadSkillDetail(skillId);
      return;
    }

    if (event.type === 'skill_analysis_failed') {
      const { error, skillId, cancelled } = event as unknown as { error: string; skillId: string; cancelled?: boolean };
      set({ isAnalyzing: false, activeCycleId: null, lastError: cancelled ? null : error });
      if (skillId) get().loadAnalysisCycles(skillId);
      return;
    }
  },

  clearError: () => set({ lastError: null }),
  clearStream: () => set({ streamEntries: [] }),
  reset: () => set({
    skills: [],
    selectedSkill: null,
    analysisCycles: [],
    projectContextFiles: [],
    isLoading: false,
    isSyncing: false,
    isAnalyzing: false,
    isStopping: false,
    isUploadingContext: false,
    isUploadingProjectContext: false,
    isLoadingProjectContext: false,
    lastError: null,
    activeCycleId: null,
    streamEntries: [],
  }),
}));
