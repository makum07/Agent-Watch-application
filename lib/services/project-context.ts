import crypto from 'crypto';
import fs from 'fs';
import { getDatabase } from '@/lib/db/database';
import type { ProjectContextFile } from '@/types/skills';

// Deterministic, filesystem-safe slug for a project string — project names
// can contain slashes/spaces (e.g. "Zeroni Product/ZER-app"), which would
// otherwise be misread as directory separators when used in a disk path.
export function computeProjectSlug(project: string): string {
  return crypto.createHash('sha256').update(project).digest('hex').slice(0, 16);
}

function mapProjectContextFileRow(row: Record<string, unknown>): ProjectContextFile {
  return {
    id: row.id as string,
    project: row.project as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    fileSize: row.file_size as number,
    textPath: (row.text_path as string) ?? null,
    extractedText: row.extracted_text as string,
    createdAt: new Date(row.created_at as number).toISOString(),
  };
}

export function listProjectContextFiles(project: string, sourceId?: string): ProjectContextFile[] {
  const db = getDatabase(sourceId);
  const rows = db.prepare(
    'SELECT * FROM project_context_files WHERE project = ? ORDER BY created_at DESC'
  ).all(project) as Array<Record<string, unknown>>;
  return rows.map(mapProjectContextFileRow);
}

export function getProjectContextFile(fileId: string, sourceId?: string): ProjectContextFile | null {
  const db = getDatabase(sourceId);
  const row = db.prepare('SELECT * FROM project_context_files WHERE id = ?').get(fileId) as Record<string, unknown> | undefined;
  return row ? mapProjectContextFileRow(row) : null;
}

// For image context files, "viewing" the file means previewing the raw
// bytes, not the extracted-text placeholder (see extractContextFileText).
export function getProjectContextFileRawBuffer(fileId: string, sourceId?: string): Buffer | null {
  const db = getDatabase(sourceId);
  const row = db.prepare('SELECT raw_path FROM project_context_files WHERE id = ?').get(fileId) as { raw_path: string } | undefined;
  if (!row) return null;
  try {
    return fs.readFileSync(row.raw_path);
  } catch {
    return null;
  }
}

export function createProjectContextFile(
  project: string,
  filename: string,
  mimeType: string,
  fileSize: number,
  rawPath: string,
  textPath: string,
  extractedText: string,
  sourceId?: string
): ProjectContextFile {
  const db = getDatabase(sourceId);
  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO project_context_files (id, project, filename, mime_type, file_size, raw_path, text_path, extracted_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project, filename, mimeType, fileSize, rawPath, textPath, extractedText, now);

  return {
    id,
    project,
    filename,
    mimeType,
    fileSize,
    textPath,
    extractedText,
    createdAt: new Date(now).toISOString(),
  };
}

export function deleteProjectContextFile(fileId: string, sourceId?: string): void {
  const db = getDatabase(sourceId);
  const row = db.prepare('SELECT raw_path, text_path FROM project_context_files WHERE id = ?').get(fileId) as { raw_path: string; text_path: string | null } | undefined;
  db.prepare('DELETE FROM project_context_files WHERE id = ?').run(fileId);
  if (row) {
    for (const p of [row.raw_path, row.text_path]) {
      if (!p) continue;
      try {
        fs.unlinkSync(p);
      } catch { /* file already gone — not fatal */ }
    }
  }
}
