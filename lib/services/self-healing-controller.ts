import path from 'path';
import fs from 'fs';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { FEEDBACK_CATEGORIES } from '@/types/feedback';
import type { SkillSummary, SkillDetailData, AnalysisRecommendation, SkillGrowthOpportunity, PhaseGrowthOpportunity } from '@/types/skills';
import {
  getClaudeProjectsDir,
  listProjectDirs,
  getProjectDisplayName,
  relativeToHome,
} from '@/lib/parser/jsonl-parser';
import { readCwdFromJsonl } from '@/lib/parser/session-cwd';
import {
  getSkillDetail,
  getNextCycleNumber,
  createAnalysisCycle,
  updateAnalysisCycle,
  checkSelfHealingThreshold,
} from './skill-registry';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval } from '@/lib/hooks/permission-state';
import { findExternalSkillDirsForSessions } from '@/lib/services/external-dirs';
import { getWslDistro } from '@/lib/sources';
import { runClaudeCliOneShot, writePermissionHookSettings } from '@/lib/services/claude-cli';
import { translateStreamEvent, createStreamLogger, createCycleBroadcaster, extractJsonFence, extractResolvedModel, extractCliSessionId } from '@/lib/services/cli-stream-log';
import { sanitizeClaudeCliModel } from '@/lib/claude-models';

// Above this, a file's extracted text is dropped from the prompt in favor of
// a pointer to its on-disk .extracted.md sidecar (see createContextFile) —
// keeps the full content available without bloating every analysis prompt.
const CONTEXT_FILE_INLINE_THRESHOLD = 20_000;

interface DeferrableContextFile {
  extractedText: string;
  textPath: string | null;
  mimeType: string;
}

// Images have no extracted text to inline or defer-to-sidecar — `textPath`
// points straight at the raw image (see attachments routes), and the agent
// is told to view it directly instead of Reading it as text.
function isImageContextFile(file: DeferrableContextFile): boolean {
  return file.mimeType.startsWith('image/');
}

function isContextFileDeferred(file: DeferrableContextFile): boolean {
  return !isImageContextFile(file) && file.extractedText.length > CONTEXT_FILE_INLINE_THRESHOLD && !!file.textPath;
}

// Directories to grant via --add-dir so the spawned analysis agent can Read
// the sidecar text of any deferred (too-large-to-inline) context file, or
// view any attached image — skill-scoped and project-scoped files live
// under different directories (see attachments routes) so both lists are
// passed in and merged here. Left untranslated for WSL — spawnClaudeCli
// translates every --add-dir target to /mnt/<drive> itself when routing
// through wsl.
function getDeferredContextFileDirs(...fileLists: DeferrableContextFile[][]): string[] {
  const dirs = new Set<string>();
  for (const files of fileLists) {
    for (const file of files) {
      if (!isContextFileDeferred(file) && !isImageContextFile(file)) continue;
      if (!file.textPath) continue;
      dirs.add(path.dirname(file.textPath));
    }
  }
  return [...dirs];
}

function formatCategory(cat: string): string {
  const meta = FEEDBACK_CATEGORIES.find(c => c.value === cat);
  return meta?.label ?? cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

function formatDateShort(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// Shared ordering for recommendation severity and growth-opportunity impact —
// the model doesn't reliably emit either array pre-sorted, and the UI reads
// list order as priority order.
function severityRank(level: string | undefined): number {
  switch (level) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

// `projectDisplayName` here is `skill.project`, which session-ingester sets to
// `realCwd ? relativeToHome(realCwd) : getProjectDisplayName(dirName)` (see
// discoverSessions) — a real cwd, when one was found in the session's JSONL,
// wins over the lossy dash-decoded directory name. Matching must replicate
// that same precedence per directory, not just `getProjectDisplayName`, or a
// project whose sessions do carry a real cwd (the common case) never matches
// and this always falls through to null.
function resolveSkillProjectCwd(projectDisplayName: string, sourceId?: string): string | null {
  try {
    const projectsDir = getClaudeProjectsDir(sourceId);
    const projectDirs = listProjectDirs(sourceId);

    for (const dirName of projectDirs) {
      const metaDir = path.join(projectsDir, dirName);
      const files = fs.readdirSync(metaDir)
        .filter((f: string) => f.endsWith('.jsonl') && !f.includes('subagent'));

      let cwd: string | null = null;
      for (const file of files) {
        cwd = readCwdFromJsonl(path.join(metaDir, file));
        if (cwd) break;
      }

      const displayName = cwd ? relativeToHome(cwd) : getProjectDisplayName(dirName);
      if (displayName !== projectDisplayName) continue;
      if (cwd) return cwd;
    }
  } catch { /* non-fatal */ }
  return null;
}

// A skill's definition file can live in a different project directory than
// the ones its executions ran in (e.g. a shared skills/agents repo added via
// `claude --add-dir`). Since analysis and fix application spawn a fresh `-p`
// process with no memory of that grant, rediscover the external directories
// from the JSONL of every session that has executed this skill and pass them
// back via `--add-dir` — otherwise Edit/Write on the real definition file is
// blocked by Claude Code's workspace boundary regardless of hook approval.
function resolveExternalSkillDirs(skillId: string, cwd: string, sourceId?: string): string[] {
  try {
    const db = getDatabase(sourceId);
    const sessionIds = db.prepare(
      'SELECT DISTINCT session_id FROM skill_executions WHERE skill_id = ?'
    ).all(skillId) as Array<{ session_id: string }>;

    const jsonlPaths: string[] = [];
    for (const { session_id } of sessionIds) {
      const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(session_id) as { file_path: string } | undefined;
      if (conv?.file_path) jsonlPaths.push(conv.file_path);
    }

    return findExternalSkillDirsForSessions(jsonlPaths, cwd);
  } catch {
    return [];
  }
}

export interface ResolvedSkillDefinition {
  /** Absolute path to SKILL.md/skill.md, or null if not found in any searched dir. */
  path: string | null;
  /** `.claude/skills` dirs actually checked — surfaced so a failed resolution
   *  can still point the model at a bounded set of places to look, instead
   *  of leaving it to search from scratch. */
  searchedDirs: string[];
}

// Resolving the definition file path here — instead of having the spawned
// agent search for it — was added after an analysis run spent its entire
// timeout on `find`/`grep` across this app's own database and source code
// (and even an unrelated repo's git history) trying to locate its own skill
// file. Only meaningful for native paths: a WSL cwd is a Linux path this
// Windows-side process can't `fs.existsSync`, so callers should pass
// `skillCwd: null` (skip resolution) when the skill's source is WSL.
function resolveSkillDefinitionPath(
  skillName: string,
  skillCwd: string | null,
  externalDirs: string[],
): ResolvedSkillDefinition {
  const skillsDirs: string[] = [];
  if (skillCwd) skillsDirs.push(path.join(skillCwd, '.claude', 'skills'));
  for (const dir of externalDirs) {
    if (path.basename(dir).toLowerCase() === 'skills') skillsDirs.push(dir);
  }

  for (const dir of skillsDirs) {
    const candidates = [
      path.join(dir, skillName, 'SKILL.md'),
      path.join(dir, skillName, 'skill.md'),
      path.join(dir, `${skillName}.md`),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return { path: candidate, searchedDirs: skillsDirs };
      } catch { /* non-fatal */ }
    }
  }
  return { path: null, searchedDirs: skillsDirs };
}

export function generateAnalysisPrompt(
  skill: SkillSummary,
  detail: SkillDetailData,
  definition?: ResolvedSkillDefinition | null,
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  // ─── Purpose ───────────────────────────────────────────────────────

  lines.push(`# Skill Analysis — \`${skill.name}\` — ${formatDateShort(now)}\n`);
  lines.push(`You are analyzing the \`${skill.name}\` skill across ${skill.totalSessions} sessions and ${skill.totalExecutions} executions. Your goal is to determine what issues persist or recur despite fixes, what structural changes to the skill definition would make it more reliable, and how the skill could evolve to provide greater value in the software development lifecycle.\n`);
  if (definition?.path) {
    lines.push(`The skill definition file is at \`${definition.path}\` — read it directly; no search is needed. Understanding what the skill is designed to do is the basis for evaluating whether the historical data reveals gaps in that design.\n`);
  } else if (definition && definition.searchedDirs.length > 0) {
    lines.push(`The skill definition file wasn't found automatically. It was expected as \`<skill-name>/SKILL.md\`, \`<skill-name>/skill.md\`, or \`<skill-name>.md\` under one of: ${definition.searchedDirs.map(d => `\`${d}\``).join(', ')} — check those locations directly rather than searching more broadly. If it's genuinely not there, say so in Current Status rather than guessing at the skill's design.\n`);
  } else {
    lines.push(`Start by reading the skill definition file: \`.claude/skills/${skill.name}/SKILL.md\` (the current Claude Code convention), or \`.claude/skills/${skill.name}.md\` if this project predates that layout. If the skill isn't in this project's own \`.claude/skills/\`, it likely lives in an externally-referenced skills directory you've been granted access to — search there before falling back to a broader search. Understanding what the skill is designed to do is the basis for evaluating whether the historical data reveals gaps in that design.\n`);
  }
  lines.push(`The data below is the complete evidence available for this analysis. Aggregate totals (the Skill table, category/agent breakdowns) cover the full history; Execution History may list only the most recent executions when there are more than it can show. Do not infer unshown historical executions or attempt to reconstruct them from outside sources. Attached Context Documents, Improvement Cycles, Prior Skill Analyses, and Execution History always appear below and say so explicitly when there's nothing to report (e.g. "None recorded") rather than being silently omitted; only the feedback breakdown tables are conditionally omitted, and their absence is already explained by the Total Feedback count above. Do not go looking for more: do not query a database, read this analysis application's own source code, or explore the git history or files of other projects to reconstruct data that isn't shown here. If a question you'd want to answer isn't covered by the data below, that absence is itself the answer — treat it as insufficient evidence, not as a research task.\n`);

  // ─── Skill metadata ─────────────────────────────────────────────────

  lines.push(`## Skill\n`);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Name | \`${skill.name}\` |`);
  lines.push(`| Project | ${skill.project} |`);
  lines.push(`| Version | ${skill.version} |`);
  if (skill.description) lines.push(`| Description | ${skill.description} |`);
  lines.push(`| Executions | ${skill.totalExecutions} across ${skill.totalSessions} sessions |`);
  lines.push(`| Total Feedback | ${skill.totalFeedback} items |`);
  if (skill.avgDurationMs > 0) lines.push(`| Avg Duration | ${Math.round(skill.avgDurationMs / 1000)}s |`);
  lines.push(`| Created | ${formatDate(skill.createdAt)} |`);
  lines.push(`| Last Execution | ${skill.lastExecutionAt ? formatDate(skill.lastExecutionAt) : 'Never'} |`);
  lines.push(`| Last Analysis | ${skill.lastAnalysisAt ? formatDate(skill.lastAnalysisAt) : 'Never'} |`);
  lines.push('');

  // ─── Execution history (raw, timestamped) ──────────────────────────
  // Without this, the model has only aggregate counts and feedback text to
  // reason about "what happened over time" — it has no per-execution
  // timestamps, durations, or session/agent breakdown. That gap was observed
  // driving the model to hunt for this data itself (querying this app's own
  // database, reading its source, wandering into unrelated repos) instead of
  // writing the analysis, burning the whole run on a research tangent.

  if (detail.executionsBySession.length > 0) {
    const EXEC_DISPLAY_LIMIT = 60;
    lines.push(`## Execution History (${detail.executionsBySession.length} most recent, newest first)\n`);
    lines.push(`| Timestamp | Session | Agent | Duration | Feedback |`);
    lines.push(`|---|---|---|---|---|`);
    for (const ex of detail.executionsBySession.slice(0, EXEC_DISPLAY_LIMIT)) {
      const duration = ex.durationMs != null ? `${Math.round(ex.durationMs / 1000)}s` : '—';
      lines.push(`| ${formatDate(ex.timestamp)} | ${ex.sessionId.slice(0, 8)} | ${ex.agentName || 'unknown'} | ${duration} | ${ex.feedbackCount} |`);
    }
    if (detail.executionsBySession.length > EXEC_DISPLAY_LIMIT) {
      lines.push(`\n…and ${detail.executionsBySession.length - EXEC_DISPLAY_LIMIT} more executions`);
    }
    lines.push('');
  } else {
    lines.push(`## Execution History\n`);
    lines.push(`No execution records exist for this skill yet.\n`);
  }

  // ─── Attached context documents ─────────────────────────────────────
  // Two scopes: project-wide (shared by every skill under the same
  // project, uploaded once) and skill-specific (this skill only). Both are
  // rendered into one section so the model reasons about them together,
  // but each entry is labeled with its scope since a project-wide finding
  // (e.g. a repo-level maturity assessment) implies different things than
  // something uploaded for this one skill.

  const totalContextFiles = detail.projectContextFiles.length + detail.contextFiles.length;
  if (totalContextFiles > 0) {
    lines.push(`## Attached Context Documents (${totalContextFiles})\n`);
    lines.push(`The user attached the following document(s) as context. Some are pure background (glossaries, domain docs, specs) — use those only to inform your understanding of the skill's purpose, domain, or audience. If a document is itself an audit, assessment, maturity model, gap analysis, roadmap, or scorecard, route each entry relevant to this skill by what it actually is: an entry that corroborates a problem the execution/feedback history already shows happening now is a Finding; an entry describing a gap this skill could evolve to close (gap → capability this skill could develop → benefit) is a Growth Opportunity, but pick only the highest-value entries this skill can meaningfully influence — not every gap in the document; an entry that is neither yet is still worth naming in Current Status as where the skill stands against the framework. Cite specific entries inline wherever used (see **Output** for the exact style), not summarized in isolation.\n`);
    lines.push(`Before treating any document entry as already resolved by this skill — and therefore leaving it out of Growth Opportunities — verify that specifically against the current skill definition file you read for this analysis (what it actually instructs the skill to do right now), not against whether a prior cycle already raised it, whether this cycle's execution history is silent on it, or how much time has passed since the document was produced. Absence from Prior Skill Analyses is not evidence of a fix. If the skill definition doesn't clearly show the gap closed, surface it again this cycle even if an earlier cycle also raised it — a genuinely unresolved gap does not get one mention and then silence.\n`);

    for (const file of detail.projectContextFiles) {
      lines.push(`### ${file.filename} — project-wide, shared across every skill in \`${skill.project}\`${isContextFileDeferred(file) ? ` (${file.extractedText.length.toLocaleString()} chars — too large to inline)` : isImageContextFile(file) ? ' (image)' : ''}\n`);
      if (isImageContextFile(file)) {
        lines.push(`This is an image file. View it directly at \`${file.textPath}\` before evaluating the skill so its content informs your analysis.\n`);
      } else if (isContextFileDeferred(file)) {
        lines.push(`Full content is available at \`${file.textPath}\`. Read this file before evaluating the skill so its content informs your analysis.\n`);
      } else {
        lines.push(file.extractedText.trim());
        lines.push('');
      }
    }
    for (const file of detail.contextFiles) {
      lines.push(`### ${file.filename} — specific to this skill${isContextFileDeferred(file) ? ` (${file.extractedText.length.toLocaleString()} chars — too large to inline)` : isImageContextFile(file) ? ' (image)' : ''}\n`);
      if (isImageContextFile(file)) {
        lines.push(`This is an image file. View it directly at \`${file.textPath}\` before evaluating the skill so its content informs your analysis.\n`);
      } else if (isContextFileDeferred(file)) {
        lines.push(`Full content is available at \`${file.textPath}\`. Read this file before evaluating the skill so its content informs your analysis.\n`);
      } else {
        lines.push(file.extractedText.trim());
        lines.push('');
      }
    }
  } else {
    lines.push(`## Attached Context Documents\n`);
    lines.push(`None attached — no project-wide or skill-specific context documents have been uploaded for this skill.\n`);
  }

  // ─── Compute open/closed classification ────────────────────────────

  const improvementCycles = detail.improvementCycles ?? [];
  const addressedByMap = new Map<string, typeof improvementCycles[number]>();
  for (const ic of improvementCycles) {
    if (ic.status === 'completed' || ic.status === 'rewound') {
      for (const fbId of ic.feedbackIds) {
        if (!addressedByMap.has(fbId)) addressedByMap.set(fbId, ic);
      }
    }
  }
  const feedbackById = new Map(detail.feedbackItems.map(f => [f.id, f]));
  const openFeedback = detail.feedbackItems.filter(f => !addressedByMap.has(f.id));
  const closedFeedback = detail.feedbackItems.filter(f => addressedByMap.has(f.id));

  // ─── Improvement cycle history (chronological) ─────────────────────

  if (improvementCycles.length > 0) {
    const sortedCycles = [...improvementCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    lines.push(`## Improvement Cycles (${improvementCycles.length})\n`);

    for (const ic of sortedCycles) {
      lines.push(`### Cycle #${ic.cycleNumber} — ${ic.status.toUpperCase()} — ${formatDate(ic.createdAt)}`);
      if (ic.completedAt) lines.push(`Completed: ${formatDate(ic.completedAt)}`);
      lines.push(`Session: ${ic.sessionId.slice(0, 12)}`);

      if (ic.feedbackIds.length > 0) {
        lines.push(`Targeted (${ic.feedbackIds.length}):`);
        for (const fbId of ic.feedbackIds) {
          const fb = feedbackById.get(fbId);
          if (fb) lines.push(`- [${formatCategory(fb.category)}] ${fb.text} *(${fb.agentName || 'unknown'}, ${formatDateShort(fb.createdAt)})*`);
          else lines.push(`- [ref] ${fbId.slice(0, 12)}`);
        }
      }

      if (ic.claudeResponse) {
        lines.push(`Response: ${ic.claudeResponse.slice(0, 3000)}${ic.claudeResponse.length > 3000 ? '…' : ''}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`## Improvement Cycles\n`);
    lines.push(`None recorded — this skill has not yet been through a feedback-driven improvement cycle.\n`);
  }

  // ─── Prior skill analyses ───────────────────────────────────────────

  if (detail.analysisCycles.length > 0) {
    const sortedAnalysis = [...detail.analysisCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    lines.push(`## Prior Skill Analyses (${detail.analysisCycles.length})\n`);
    lines.push(`For each recommendation below, trace what happened after it: previous problem → the fix that was proposed/applied → what the executions and feedback since then actually show. Classify the outcome as worked (the issue is gone in subsequent data), partially worked (reduced but not eliminated), failed (the same root cause still produces the same issue — treat this as a regression and surface it at higher severity than a first-time finding, since a prior fix already failed to hold), or not yet evaluable (too little execution volume since the fix to tell — say so as uncertainty, not as a resolved or open finding). When a fix failed, say why in mechanism terms — too narrow, covering only one path to the root cause, or addressing the symptom the fix was aimed at rather than the underlying dependency — not just that the issue recurred. Do not restate a prior finding purely to repeat it; restate it only when this trace shows something new about whether it held.\n`);
    lines.push(`Execution/feedback volume since a prior fix is a slow, indirect signal — thin volume can look like "not yet evaluable" even when the fix was never actually applied. The current skill definition file you read for this analysis is the direct, immediate check: before classifying a prior recommendation as worked, partially worked, or not yet evaluable, confirm whether the proposed change is textually present in the definition now, regardless of whether the linked improvement cycle's status says completed, cancelled, or failed — a cycle marked completed can still have missed the intended edit, and one marked cancelled or failed is direct confirmation the fix never landed, not something to wait on more execution data to resolve. Never classify a fix as worked based on quiet execution/feedback history alone if the definition itself still shows the old behavior.\n`);

    for (const cycle of sortedAnalysis) {
      lines.push(`### Analysis #${cycle.cycleNumber} — ${formatDate(cycle.createdAt)}`);
      lines.push(`${cycle.status} | ${cycle.triggerType === 'auto_threshold' ? 'automatic' : 'manual'} | ${cycle.sessionsAnalyzed.length} sessions, ${cycle.feedbackAnalyzed.length} feedback items`);

      if (cycle.recommendations && cycle.recommendations.length > 0) {
        for (const rec of cycle.recommendations) {
          lines.push(`- [${rec.severity}] ${rec.title}: ${rec.proposedChange}`);
        }
      }
      if (cycle.analysisResponse) {
        lines.push(`Summary: ${cycle.analysisResponse.slice(0, 400)}${cycle.analysisResponse.length > 400 ? '…' : ''}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`## Prior Skill Analyses\n`);
    lines.push(`None — this is the first analysis on record for this skill.\n`);
  }

  // ─── Feedback overview ──────────────────────────────────────────────

  if (detail.feedbackByCategory.length > 0) {
    lines.push(`## Feedback by Category\n`);
    lines.push(`| Category | Total | Open | Closed |`);
    lines.push(`|----------|-------|------|--------|`);
    for (const fb of detail.feedbackByCategory) {
      const openCount = openFeedback.filter(f => f.category === fb.category).length;
      const closedCount = closedFeedback.filter(f => f.category === fb.category).length;
      lines.push(`| ${fb.label} | ${fb.count} | ${openCount} | ${closedCount} |`);
    }
    lines.push('');
  }

  if (detail.feedbackByAgent.length > 0) {
    lines.push(`## Feedback by Agent\n`);
    lines.push(`| Agent | Total | Open | Closed |`);
    lines.push(`|-------|-------|------|--------|`);
    for (const agent of detail.feedbackByAgent.slice(0, 15)) {
      const agentFb = detail.feedbackItems.filter(f => f.agentName === agent.agentName);
      const agentOpen = agentFb.filter(f => !addressedByMap.has(f.id)).length;
      const agentClosed = agentFb.filter(f => addressedByMap.has(f.id)).length;
      lines.push(`| ${agent.agentName} | ${agent.count} | ${agentOpen} | ${agentClosed} |`);
    }
    lines.push('');
  }

  // ─── Open feedback (timestamped, grouped by category) ──────────────

  if (openFeedback.length > 0) {
    const sorted = [...openFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`## Open Feedback (${openFeedback.length} unaddressed)\n`);
    const byCategory = new Map<string, typeof sorted>();
    for (const fb of sorted) {
      if (!byCategory.has(fb.category)) byCategory.set(fb.category, []);
      byCategory.get(fb.category)!.push(fb);
    }
    for (const [cat, items] of Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`### ${formatCategory(cat)} (${items.length})\n`);
      for (const item of items) {
        lines.push(`- [${formatDate(item.createdAt)}] ${item.text} *(${item.agentName || 'unknown'}, session ${item.sessionId.slice(0, 8)})*`);
      }
      lines.push('');
    }
  }

  // ─── Addressed feedback (with cycle refs for fix-effectiveness) ─────

  if (closedFeedback.length > 0) {
    const sorted = [...closedFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`## Addressed Feedback (${closedFeedback.length})\n`);
    lines.push(`Use timestamps: if the same category reappears in Open Feedback above after being closed here, the fix did not hold.\n`);
    for (const item of sorted.slice(0, 80)) {
      const cycle = addressedByMap.get(item.id);
      const ref = cycle ? `Cycle #${cycle.cycleNumber} (${formatDateShort(cycle.createdAt)}, ${cycle.status})` : 'unknown cycle';
      lines.push(`- [${formatDate(item.createdAt)}] [${formatCategory(item.category)}] ${item.text} *(${item.agentName || 'unknown'}) — ${ref}*`);
    }
    if (sorted.length > 80) lines.push(`\n…and ${sorted.length - 80} more`);
    lines.push('');
  }

  // ─── Pre-computed temporal signals ─────────────────────────────────

  const closedCategories = new Set(closedFeedback.map(f => f.category));
  const recurringCats = [...new Set(openFeedback.filter(f => closedCategories.has(f.category)).map(f => f.category))];
  if (recurringCats.length > 0) {
    lines.push(`## Recurrence Signal\n`);
    lines.push(`Categories with both addressed AND currently open items — fixes in these categories did not hold:\n`);
    for (const cat of recurringCats) {
      const openCount = openFeedback.filter(f => f.category === cat).length;
      const closedCount = closedFeedback.filter(f => f.category === cat).length;
      lines.push(`- **${formatCategory(cat)}**: ${openCount} still open, ${closedCount} previously addressed`);
    }
    lines.push('');
  }

  if (improvementCycles.length > 0) {
    const completedCycles = improvementCycles
      .filter(ic => ic.status === 'completed' && ic.completedAt)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

    if (completedCycles.length > 0) {
      const lastCompletedAt = completedCycles[completedCycles.length - 1].completedAt!;
      const postFixFeedback = openFeedback.filter(
        f => new Date(f.createdAt).getTime() > new Date(lastCompletedAt).getTime()
      );
      if (postFixFeedback.length > 0) {
        lines.push(`**${postFixFeedback.length} open item(s) appeared after the last improvement cycle (${formatDateShort(lastCompletedAt)}) — new issues, not yet addressed:**\n`);
        for (const fb of postFixFeedback.slice(0, 10)) {
          lines.push(`- [${formatDate(fb.createdAt)}] [${formatCategory(fb.category)}] ${fb.text}`);
        }
        lines.push('');
      }
    }
  }

  // ─── Reasoning model (replaces an itemized finding checklist) ───────

  lines.push(`## Analysis Approach\n`);
  lines.push(`Reason from the skill's intended behavior to the observed evidence, rather than checking off a list of symptoms. For each significant issue or pattern:\n`);
  lines.push(`1. Establish what the skill is supposed to do, from its definition.`);
  lines.push(`2. Determine whether the available history shows a meaningful deviation from that intent.`);
  lines.push(`3. Check whether the deviation persists, recurs, or returned after a prior fix (see Prior Skill Analyses above).`);
  lines.push(`4. Identify the smallest structural cause in the skill definition that plausibly explains it — the mechanism, not the symptom. ("Agent sometimes misses required fields" is a symptom; "validation runs after generation instead of constraining it" is a structural cause.)`);
  lines.push(`5. Decide whether the cause needs a corrective change now (Findings & Fixes) or is better treated as a future capability (Growth Opportunities).`);
  lines.push(`6. Prefer explanations supported by multiple independent observations over a single instance; treat thin or ambiguous evidence as uncertainty, not as a finding.\n`);
  lines.push(`Feedback volume, execution frequency, duration, and category counts are starting points for locating a pattern, not evidence of a defect by themselves — connect any pattern back to an observable mechanism in the skill definition or execution history before treating it as real.\n`);
  lines.push(`Do not optimize for the number of findings. A small number of well-supported findings beats a comprehensive list of possibilities.\n`);

  // ─── Output ─────────────────────────────────────────────────────────

  lines.push(`## Output\n`);
  lines.push(`Every section must reach a useful conclusion supported by the available evidence — substantive prose where the history supports it, and an explicit statement of insufficient evidence where it doesn't, rather than speculation to fill space. This applies regardless of whether a context document is attached: a skill with no attached documents deserves an equally rigorous report, sourced from its definition, feedback, and execution history alone.\n`);
  lines.push(`Language: write every section, and every field value in the JSON below, in plain, everyday language that anyone reading this report can follow — regardless of their technical background or how familiar they are with this specific skill. The labels used to organize your reasoning above ("mechanism", "root cause", "structural cause", "SDLC contribution/impact", "self-correction signal", "affected component") describe how you structure your thinking — they are not words to drop into the prose as if they explain themselves. Describe what is actually happening in plain, specific terms rather than naming the abstract category it falls into. Simplifying the language must not mean dropping specifics — keep every timestamp, count, citation, and concrete detail the report already requires; say the same true, specific thing in plain words, not a vaguer version of it.\n`);
  lines.push(`Write four sections, in this order:\n`);
  lines.push(`### 1. Current Status`);
  lines.push(`Write 2-4 short paragraphs, separated by a blank line, not one dense block — this is a status report someone could read at a glance without opening any recommendation, so it needs visible breaks between ideas, not just topic changes mid-sentence. Cover, roughly one topic per paragraph: (1) the skill's health trend (improving, stable, degrading, or indeterminate — use indeterminate rather than stable when volume is too thin to support a trend) with evidence from the timestamps; (2) how reliably it is being used (execution volume, recurrence of issues, whether fixes have held); (3) if an attached document scores or audits this skill's domain, where it currently sits against that framework, including any relevant entry that named neither a Finding nor a Growth Opportunity. Skip any paragraph with nothing to say rather than padding it.\n`);
  lines.push(`### 2. Findings & Fixes`);
  lines.push(`Surface each meaningful finding from the reasoning in **Analysis Approach** above, each paired with a concrete fix. Explain the pattern like you're briefing someone who has not read the raw data — what is happening, the mechanism behind it, the evidence, your confidence, and, where a prior recommendation targeted the same area, whether it worked, partially worked, failed, or can't yet be evaluated. Prefer the smallest structural change that addresses the identified root cause over a broad rewrite; a recommendation should change the skill's behavior or reasoning mechanism, not add wording that merely restates an instruction the skill already contains. If nothing meaningful surfaces, say so directly; this section is allowed to be short when the history is clean.\n`);
  lines.push(`### 3. Growth Opportunities`);
  lines.push(`This section is forward-looking, not a second pass over history: it evaluates the skill's current capability and purpose against its potential — not against what has gone wrong. When an audit, assessment, maturity model, gap analysis, roadmap, or scorecard is attached, treat it as the primary source of direction here (see **Attached Context Documents** above for how entries get routed): reason from assessment gap or unmet condition → capability this skill could develop → how that capability would improve the skill or its SDLC contribution, and cite the specific entry, condition, or score behind each opportunity drawn from it. "The assessment recommends improving traceability" is not that reasoning; "the assessment marks condition 4.2 (test traceability) as partially met, this skill currently has no persistent link between a generated test case and its execution outcome, so it could emit that mapping as an artifact" is. Draw only on the highest-value gaps this specific skill can meaningfully influence — do not force an irrelevant or unaddressable gap into the report just because the document contains it.`);
  lines.push(`With no such document, ground opportunities in the skill's own definition and SDLC potential instead. Either way, execution history plays a supporting role only: use it to validate that an opportunity is feasible, or to show where the skill has already demonstrated room to grow — not to re-surface a Findings & Fixes item under a new name. Look for ways this skill could become more self-verifying, more autonomous, and better connected to the rest of the SDLC (its inputs, its outputs, and what happens next) — only where genuinely grounded in what this skill does, not as a checklist to fill.`);
  lines.push(`Rank each opportunity high/medium/low by how much it would move this skill's reliability or SDLC contribution — this is required per opportunity, the same way severity is required per finding above.`);
  lines.push(`If nothing genuine applies, say so rather than inventing generic advice — an empty section is better than padding.\n`);
  lines.push(`### 4. Phase-Level Growth Opportunities`);
  lines.push(`This section is distinct from Growth Opportunities above and easy to conflate with it — keep them apart. Growth Opportunities asks what *this skill* can develop; this section asks what *the whole SDLC phase or domain this skill belongs to* still lacks, using an attached audit/maturity/gap-analysis/roadmap/scorecard as the primary source. Only write this section when such a document is attached and gives enough evidence to reason about the phase as a whole (e.g. a "Testing & QA" or "Code Review & Security" category with multiple conditions) — not merely because the skill exists. If no such document is attached, or it doesn't cover this skill's domain at the phase level, say so explicitly and leave the section empty; do not invent a phase framework that isn't in the evidence.`);
  lines.push(`First identify which phase/domain in the document this skill belongs to (e.g. this skill's actions map it to "Testing & QA"). Then, for each opportunity, reason through this chain and make every link explicit, not just the endpoints: current skill → what this skill contributes to that phase today → the resulting phase capability once this skill's own Growth Opportunities (Section 3) are implemented → what the phase's audited conditions still mark as unmet or partial beyond that → why this specific skill cannot or should not be the thing that closes that remaining gap (wrong layer, wrong owner, requires infrastructure or a different skill/process entirely) → the concrete next capability, skill, process, or automation the team would need to build instead. This is a roadmap from where the skill's own improvements land to where the phase as a whole still falls short, not a second list of things this skill should do.`);
  lines.push(`Do not restate a Section 3 Growth Opportunity here under a new name, and do not turn every unmet condition in the document into an entry — pick only the conditions that are relevant to this skill's phase and materially help the user understand what remains beyond this skill's responsibility. A gap in an unrelated phase (e.g. deployment conditions, when this skill is a testing skill) does not belong here even if the same document contains it.`);
  lines.push(`Rank each opportunity high/medium/low by how much closing it would move the phase's overall maturity — this is about the phase's contribution, not this skill's own reliability (that ranking belongs to Section 3).`);
  lines.push(`If nothing genuine applies — no audit document, or nothing in it reasons cleanly to a phase-level gap this skill doesn't own — say so directly rather than padding; an empty section is better than a forced one.\n`);
  lines.push(`### Citing attached documents`);
  lines.push(`Wherever any section above draws on an attached document, cite it inline the way you would in a written report — name the document and the specific entry, condition, sheet, or score it comes from (e.g. "per MaturityAssessment.xlsx, condition 3.2 (Not Met), ..."), woven into the sentence, not appended as a separate checklist. That specificity is what makes it verifiable that the document was actually read rather than skimmed for keywords — a vague reference like "the maturity assessment suggests improvements" is not acceptable. If an attached document contains no evidence relevant to this skill's analysis, do not force it into the report; briefly note this in Current Status only when useful for explaining the scope of the assessment.\n`);
  lines.push(`Do not make any changes to files. This is an analysis report only. Growth Opportunities are strategic and belong to the user's judgment, not \`fixPrompt\` — only Findings & Fixes recommendations that are safe, concrete file edits belong there. \`fixPrompt\` must be a single implementation prompt that addresses every entry in \`recommendations\` together, not just the first or highest-severity one, and it must scope its edits to this skill's own definition file (and, where relevant, its own bundled resources) — not to unrelated parts of the repository. It must preserve everything about the skill's existing behavior that the evidence didn't identify as part of the problem — no unrelated rewrites, restructuring, or speculative improvements pulled in from Growth Opportunities. If Findings & Fixes has nothing to report, \`fixPrompt\` should be omitted or empty.\n`);
  lines.push(`End with:\n`);
  lines.push('```json');
  lines.push(`{"currentStatus": "...", "recommendations": [{"severity": "high|medium|low", "title": "...", "rootCause": "...", "affectedComponent": "...", "proposedChange": "...", "evidence": ["..."], "confidence": "high|medium|low", "selfCorrectionSignal": "..."}], "growthOpportunities": [{"title": "...", "currentState": "...", "targetState": "...", "rationale": "...", "sdlcImpact": "...", "suggestedChange": "...", "impact": "high|medium|low", "sourceDocument": "filename or null", "sourceEvidence": "specific entry, condition, score, sheet, or section, or null"}], "phaseGrowthOpportunities": [{"phase": "...", "title": "...", "currentContribution": "...", "afterSkillImprovements": "...", "remainingGap": "...", "whyOutOfScope": "...", "recommendedNextCapability": "...", "impact": "high|medium|low", "sourceDocument": "filename or null", "sourceEvidence": "specific entry, condition, score, sheet, or section, or null"}], "fixPrompt": "..."}`);
  lines.push('```');
  lines.push(`\`currentStatus\` is not a separate, compressed summary of Section 1 — it IS Section 1's content, verbatim, and it is what actually gets shown to the user (the free-form write-up above it is discarded). It must keep the same 2-4 paragraph structure from the Current Status instructions, with a blank line (\`\\n\\n\` in the JSON string) between paragraphs — do not collapse it into one dense block just because it's a JSON string value.`);
  lines.push(`\`rootCause\` and \`proposedChange\` should each be a few sentences, matching the depth of the Current Status and Growth Opportunities prose above — not a fragment. \`rootCause\` should name the mechanism producing the symptom (including, if applicable, why an earlier fix in this area didn't hold), and \`proposedChange\` should make clear why this change addresses that mechanism rather than the surface symptom. \`evidence\` is a list of specific, citable data points backing the finding — timestamps, session IDs, counts, or a document citation in the inline style above; weight repeated evidence over an isolated instance. \`selfCorrectionSignal\` is a concrete, observable signal in future execution data that would confirm the fix held or reveal it didn't. \`impact\` on a growth opportunity is how much it would move this skill's reliability or SDLC contribution if pursued. \`sourceDocument\` is the filename it came from, or \`null\` if it came purely from the skill definition/execution history; when set, \`sourceEvidence\` names the specific entry, condition, or score within that document driving this opportunity — the structured counterpart to the inline citation in the prose above, or \`null\` if \`sourceDocument\` is \`null\`.`);
  lines.push(`\`phaseGrowthOpportunities\` is the structured form of Section 4 — omit it (or leave it an empty array) whenever that section has nothing genuine to report. \`phase\` names the SDLC phase/domain from the attached document this entry belongs to (e.g. "Testing & QA"). \`currentContribution\` and \`afterSkillImprovements\` describe the bridge from this skill's present state to the phase capability it enables once its own Section 3 opportunities ship. \`remainingGap\` is what the phase's audited conditions still mark unmet or partial beyond that. \`whyOutOfScope\` explains concretely why this skill isn't the right owner for that gap. \`recommendedNextCapability\` names the next skill, process, or automation the team would need instead. \`impact\` ranks by how much closing the gap would move the phase's overall maturity, not this skill's own reliability. \`sourceDocument\`/\`sourceEvidence\` follow the same rule as in \`growthOpportunities\` and should not be \`null\` here — this section only exists when a phase-level audit document supports it.`);

  return lines.join('\n');
}

export function generatePromptPreview(skillId: string, sourceId?: string): string | null {
  const detail = getSkillDetail(skillId, sourceId);
  if (!detail) return null;
  const skillCwd = resolveSkillProjectCwd(detail.skill.project, sourceId);
  const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd, sourceId) : [];
  const definition = getWslDistro(sourceId) ? null : resolveSkillDefinitionPath(detail.skill.name, skillCwd, externalDirs);
  return generateAnalysisPrompt(detail.skill, detail, definition);
}

export async function runSkillAnalysis(
  cycleId: string,
  skillId: string,
  customPrompt?: string,
  sourceId?: string,
  model?: string
): Promise<void> {
  const db = getDatabase(sourceId);
  const resolvedModel = sanitizeClaudeCliModel(model);

  const broadcast = createCycleBroadcaster({ skillId, cycleId });
  const log = createStreamLogger('sa');

  try {
    broadcast('skill_analysis_started', {});

    const detail = getSkillDetail(skillId, sourceId);
    if (!detail) {
      updateAnalysisCycle(cycleId, { status: 'failed' }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Skill not found' });
      return;
    }

    const skillCwd = resolveSkillProjectCwd(detail.skill.project, sourceId);

    log.push({
      kind: 'system',
      text: `Starting skill analysis for "${detail.skill.name}" (${detail.skill.project})${skillCwd ? ` in ${skillCwd}` : ''}...`,
    });

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd, sourceId) : [];

    // WSL-sourced skill: cwd is a native Linux path — a Windows-side spawn
    // can't cd into it (cmd.exe rejects UNC paths as a cwd). Route through
    // `wsl -d <distro> -- bash -lc` so PATH additions (nvm, ~/.local/bin)
    // still resolve `claude`, same fix already proven for other flows.
    const wslDistro = getWslDistro(sourceId);

    // Resolved after skillCwd/externalDirs above (not before) so the model
    // gets an exact file path to Read instead of having to search for it —
    // skip resolution for WSL, whose cwd is a Linux path this Windows-side
    // process can't stat.
    const definition = wslDistro ? null : resolveSkillDefinitionPath(detail.skill.name, skillCwd, externalDirs);
    const prompt = customPrompt || generateAnalysisPrompt(detail.skill, detail, definition);

    // Deferred (too-large-to-inline) context files live on this (Windows)
    // process's disk — spawnClaudeCli translates every --add-dir target to
    // /mnt/<drive> itself when routing through wsl, so pass raw paths here.
    const contextDirs = getDeferredContextFileDirs(detail.contextFiles, detail.projectContextFiles);

    function handleStreamEvent(event: Record<string, unknown>) {
      broadcast('skill_analysis_stream_event', { event });
      const resolvedActualModel = extractResolvedModel(event);
      const cliSessionId = extractCliSessionId(event);
      if (resolvedActualModel || cliSessionId) {
        updateAnalysisCycle(cycleId, { model: resolvedActualModel, cliSessionId }, sourceId);
      }
      for (const entry of translateStreamEvent(event)) log.push(entry);
    }

    // No timeoutMs: analyses now include a Current Status writeup, richer
    // per-finding evidence/confidence, and a Growth Opportunities section,
    // and can legitimately read a large attached audit document — duration
    // varies with input size rather than fitting a fixed budget. The stop
    // button (cancelJob, wired through `jobId` below) is the user's control
    // for ending a run early; matches applySkillFix, which has never had
    // a timeout since it can genuinely wait a long time on browser approvals.
    const { exitCode, stderr, fullText: responseText, cancelled } = await runClaudeCliOneShot({
      prompt,
      cwd: skillCwd || undefined,
      model: resolvedModel,
      permission: { mode: 'skipPermissions' },
      externalDirs: [...externalDirs, ...contextDirs],
      wslDistro,
      onEvent: handleStreamEvent,
      jobId: cycleId,
    });

    if (cancelled) {
      log.push({ kind: 'system', text: 'Analysis stopped by user.' });
      updateAnalysisCycle(cycleId, {
        status: 'cancelled',
        analysisResponse: responseText || null,
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Stopped by user', cancelled: true });
      return;
    }

    if (exitCode !== 0) {
      const errorDetail = stderr.trim() || `Process exited with code ${exitCode}`;
      log.push({ kind: 'system', text: `Analysis process failed (exit code ${exitCode}): ${errorDetail.slice(0, 500)}` });
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseText || null,
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
      broadcast('skill_analysis_failed', { error: errorDetail.slice(0, 300) });
      return;
    }

    const fullResponse = responseText;

    let recommendations: AnalysisRecommendation[] | null = null;
    let fixPrompt: string | null = null;
    let currentStatus: string | null = null;
    let growthOpportunities: SkillGrowthOpportunity[] | null = null;
    let phaseGrowthOpportunities: PhaseGrowthOpportunity[] | null = null;
    const parsed = extractJsonFence(fullResponse);
    if (parsed) {
      if (Array.isArray(parsed.recommendations)) {
        recommendations = (parsed.recommendations as AnalysisRecommendation[])
          .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      }
      if (typeof parsed.fixPrompt === 'string') {
        fixPrompt = parsed.fixPrompt;
      }
      if (typeof parsed.currentStatus === 'string') {
        currentStatus = parsed.currentStatus;
      }
      if (Array.isArray(parsed.growthOpportunities)) {
        growthOpportunities = (parsed.growthOpportunities as SkillGrowthOpportunity[])
          .sort((a, b) => severityRank(a.impact) - severityRank(b.impact));
      }
      if (Array.isArray(parsed.phaseGrowthOpportunities)) {
        phaseGrowthOpportunities = (parsed.phaseGrowthOpportunities as PhaseGrowthOpportunity[])
          .sort((a, b) => severityRank(a.impact) - severityRank(b.impact));
      }
    }

    const skillMode = db.prepare('SELECT self_healing_mode FROM skills WHERE id = ?').get(skillId) as { self_healing_mode: string } | undefined;
    const mode = skillMode?.self_healing_mode ?? 'analysis_only';

    let finalStatus: 'completed' | 'awaiting_review' = 'completed';
    if (mode === 'analysis_and_fix' && fixPrompt) {
      finalStatus = 'awaiting_review';
    } else if (mode === 'fully_automatic' && fixPrompt) {
      finalStatus = 'awaiting_review';
    }

    log.push({ kind: 'system', text: `Analysis ${finalStatus}. ${recommendations?.length ?? 0} recommendations generated.` });

    updateAnalysisCycle(cycleId, {
      analysisResponse: fullResponse,
      fixPrompt,
      recommendations,
      currentStatus,
      growthOpportunities,
      phaseGrowthOpportunities,
      status: finalStatus,
      streamEntries: log.entries.length > 0 ? log.entries : null,
    }, sourceId);

    broadcast('skill_analysis_complete', { status: finalStatus });

    if (mode === 'fully_automatic' && fixPrompt) {
      await applySkillFix(cycleId, skillId, fixPrompt, sourceId, resolvedModel);
    }
  } catch (err) {
    log.push({ kind: 'system', text: `Analysis failed: ${String(err)}` });

    try {
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
    } catch (updateErr) {
      try {
        getDatabase(sourceId).prepare('UPDATE skill_analysis_cycles SET status = ?, completed_at = ? WHERE id = ?')
          .run('failed', Date.now(), cycleId);
      } catch { /* best effort */ }
      console.error('Failed to update analysis cycle:', updateErr);
    }
    broadcast('skill_analysis_failed', { error: String(err) });
  }
}

export async function applySkillFix(
  cycleId: string,
  skillId: string,
  fixPrompt: string,
  sourceId?: string,
  model?: string
): Promise<void> {
  const resolvedModel = sanitizeClaudeCliModel(model);
  const wss = getWsServer();
  const broadcast = createCycleBroadcaster({ skillId, cycleId });

  const detail = getSkillDetail(skillId, sourceId);
  const skillCwd = detail ? resolveSkillProjectCwd(detail.skill.project, sourceId) : null;

  const { settingsPath, cleanup: cleanupSettings } = writePermissionHookSettings('agentwatch-hook-skill', cycleId);

  let registeredSessionId: string | null = null;
  let unsubscribe: (() => void) | undefined;

  try {
    updateAnalysisCycle(cycleId, { status: 'applying' }, sourceId);

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd, sourceId) : [];
    const wslDistro = getWslDistro(sourceId);

    unsubscribe = wss?.onClientMessage((msg: Record<string, unknown>) => {
      if (msg.type === 'permission_response' && msg.cycleId === cycleId) {
        resolveApproval(msg.requestId as string, msg.approved as boolean);
      }
    });

    function handleStreamEvent(event: Record<string, unknown>) {
      if (event.type === 'system' && typeof event.session_id === 'string' && !registeredSessionId) {
        registeredSessionId = event.session_id as string;
        registerActiveCycle(registeredSessionId, cycleId);
      }

      const resolvedActualModel = extractResolvedModel(event);
      const cliSessionId = extractCliSessionId(event);
      if (resolvedActualModel || cliSessionId) {
        updateAnalysisCycle(cycleId, { model: resolvedActualModel, cliSessionId }, sourceId);
      }

      broadcast('skill_analysis_stream_event', { event });
    }

    // Grant Edit/Write access to the skill's real definition directory when it
    // lives outside skillCwd — otherwise the workspace-boundary check blocks
    // the edit even after the user approves it via the browser hook.
    const { cancelled } = await runClaudeCliOneShot({
      prompt: fixPrompt,
      cwd: skillCwd || undefined,
      model: resolvedModel,
      permission: { mode: 'hook', settingsPath },
      externalDirs,
      wslDistro,
      onEvent: handleStreamEvent,
      jobId: cycleId,
    });

    if (cancelled) {
      updateAnalysisCycle(cycleId, { status: 'cancelled' }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Stopped by user', cancelled: true });
      return;
    }

    const db = getDatabase(sourceId);
    db.prepare('UPDATE skills SET version = version + 1, updated_at = ? WHERE id = ?').run(Date.now(), skillId);

    updateAnalysisCycle(cycleId, { status: 'completed' }, sourceId);
    broadcast('skill_analysis_complete', { status: 'completed' });
  } catch (err) {
    updateAnalysisCycle(cycleId, { status: 'failed' }, sourceId);
    broadcast('skill_analysis_failed', { error: String(err) });
  } finally {
    unsubscribe?.();
    if (registeredSessionId) unregisterActiveCycle(registeredSessionId);
    cleanupSettings();
  }
}

export async function triggerAutoAnalysis(skillId: string, sourceId?: string): Promise<void> {
  if (!checkSelfHealingThreshold(skillId, sourceId)) return;

  const detail = getSkillDetail(skillId, sourceId);
  if (!detail) return;

  const cycleNumber = getNextCycleNumber(skillId, sourceId);
  const prompt = generatePromptPreview(skillId, sourceId) ?? generateAnalysisPrompt(detail.skill, detail);

  const sessionIds = [...new Set(detail.recentExecutions.map(e => e.sessionId))];
  const feedbackIds: string[] = [];

  const db = getDatabase(sourceId);
  const fbRows = db.prepare(`
    SELECT fi.id FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id AND fi.agent_id = se.agent_id
    WHERE se.skill_id = ?
  `).all(skillId) as Array<{ id: string }>;
  feedbackIds.push(...fbRows.map(r => r.id));

  const cycle = createAnalysisCycle(skillId, cycleNumber, 'auto_threshold', prompt, sessionIds, feedbackIds, sourceId);

  setImmediate(() => {
    runSkillAnalysis(cycle.id, skillId, undefined, sourceId).catch(err => {
      console.error('Auto skill analysis failed:', err);
    });
  });
}
