'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderGit2, Upload, Trash2, Loader2, AlertTriangle, X } from 'lucide-react';
import { useSkillStore, type ViewedContextFile } from '@/store/skill-store';
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';

interface ProjectContextDocumentsProps {
  project: string;
}

// Sibling to ContextDocuments (skill-scoped) — this one is shared by every
// skill under the same `project`, so it's uploaded once instead of
// re-uploaded per skill. Deliberately independent of `selectedSkill` (unlike
// ContextDocuments) so it can be opened from the skills list — managing
// project-wide documents shouldn't require opening a specific skill first.
// See generateAnalysisPrompt in self-healing-controller.ts for how both
// scopes are merged into one prompt.
export function ProjectContextDocuments({ project }: ProjectContextDocumentsProps) {
  const {
    projectContextFiles, loadProjectContextFiles, uploadProjectContextFile, deleteProjectContextFile, viewProjectContextFile,
    isUploadingProjectContext, isLoadingProjectContext, lastError, clearError,
  } = useSkillStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewedContextFile | 'loading' | null>(null);

  useEffect(() => {
    loadProjectContextFiles(project);
  }, [project, loadProjectContextFiles]);

  const files = projectContextFiles;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadProjectContextFile(project, file);
  };

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    await deleteProjectContextFile(fileId);
    setDeletingId(null);
  };

  const handleView = async (fileId: string) => {
    setViewing('loading');
    const result = await viewProjectContextFile(fileId);
    setViewing(result);
  };

  return (
    <div className="rounded-lg border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-[var(--aw-blue)]" />
          <span className="text-sm font-medium text-[var(--aw-text-0)]">Project Documents</span>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isUploadingProjectContext}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)] transition-colors font-medium disabled:opacity-50"
        >
          {isUploadingProjectContext ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {isUploadingProjectContext ? 'Uploading...' : 'Upload'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.pptx,.md,.txt,.jpg,.jpeg,.png" className="hidden" onChange={handleFileChange} />
      </div>

      <p className="text-[11px] text-[var(--aw-text-4)] mb-3">
        Attach .xlsx, .pptx, .md, .txt, .jpg, .jpeg, or .png files once here — they&apos;re shared by every skill in{' '}
        <span className="font-mono text-[var(--aw-text-2)]">{project}</span>, so you don&apos;t need to re-upload per skill.
      </p>

      {lastError && (
        <div className="flex items-start gap-2 mb-3 px-2.5 py-2 rounded border border-[var(--aw-red-bright)]/30 bg-[var(--aw-red-bright)]/5 text-[11px] text-[var(--aw-red-bright)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{lastError}</span>
          <button onClick={clearError} className="shrink-0 hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isLoadingProjectContext ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--aw-text-4)]" />
        </div>
      ) : files.length === 0 ? (
        <p className="text-[11px] text-[var(--aw-text-4)] italic">No project documents attached.</p>
      ) : (
        <div className="space-y-1.5">
          {files.map(file => (
            <div
              key={file.id}
              className="flex items-center gap-2 px-2.5 py-2 rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] text-xs"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[var(--aw-text-2)]" />
              <button
                onClick={() => handleView(file.id)}
                className="flex-1 truncate text-left text-[var(--aw-text-1)] hover:text-[var(--aw-blue)] hover:underline"
                title="View extracted content"
              >
                {file.filename}
              </button>
              <span className="shrink-0 text-[var(--aw-text-4)]">{formatBytes(file.fileSize)}</span>
              <span className="shrink-0 text-[var(--aw-text-4)]">{formatRelativeTime(file.createdAt)}</span>
              <button
                onClick={() => handleDelete(file.id)}
                disabled={deletingId === file.id}
                className="shrink-0 p-1 rounded hover:bg-[var(--aw-bg-2)] text-[var(--aw-text-4)] hover:text-[var(--aw-red-bright)] disabled:opacity-50"
                title="Remove"
              >
                {deletingId === file.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={o => { if (!o) setViewing(null); }}>
        <DialogContent className="sm:max-w-2xl bg-[var(--aw-bg-1)] border-[var(--aw-bg-3)] text-[var(--aw-text-0)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono">
              {viewing && viewing !== 'loading' ? viewing.filename : 'Loading…'}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto bg-[var(--aw-bg-0)] rounded border border-[var(--aw-bg-2)] p-4">
            {viewing === 'loading' ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--aw-text-2)]" />
              </div>
            ) : viewing && 'dataUrl' in viewing ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewing.dataUrl} alt={viewing.filename} className="max-w-full mx-auto" />
            ) : viewing ? (
              <MarkdownRenderer content={viewing.extractedText} size="sm" />
            ) : null}
          </div>
          <p className="text-[10px] text-[var(--aw-text-4)]">
            This is exactly the content included in the analysis prompt for every skill in this project.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
