'use client';

import { ChevronDown, ChevronRight, Info } from 'lucide-react';

// Shared building blocks for "cycle" style UIs (Apply Improvements history,
// AI session/skill analysis history) — one consistent shape for the
// at-a-glance meta strip, collapsible sub-section headers, and labeled
// detail fields, instead of each surface inventing its own.

// A small hoverable "?" affordance for explaining a section/label a
// first-time viewer wouldn't recognize on its own — e.g. what distinguishes
// "Execution Findings" from "Outcome Quality" from "Enhancement
// Opportunities". Uses the browser's native title tooltip, consistent with
// how the rest of the app already surfaces hover explanations (model
// badges, confidence labels), rather than introducing a custom popover.
export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="inline-flex shrink-0 cursor-help" title={text} aria-label={text}>
      <Info className="h-3 w-3 text-[var(--aw-text-4)] hover:text-[var(--aw-text-2)] transition-colors" />
    </span>
  );
}

// A small icon+text pill used in a cycle header's at-a-glance meta strip —
// keeps the summary reading as a single row instead of ad-hoc bits.
export function MetaChip({ icon, children, color }: { icon: React.ReactNode; children: React.ReactNode; color?: string }) {
  return (
    <span className="flex items-center gap-1 shrink-0" style={color ? { color } : undefined}>
      <span className="shrink-0 [&>svg]:h-2.5 [&>svg]:w-2.5">{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

// Shared header for every collapsible sub-section inside an expanded cycle
// (prompt, activity log, files) — one consistent icon/label/count/chevron
// shape instead of each section inventing its own.
export function CycleSectionHeader({
  icon, label, count, trailing, open, onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  trailing?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-[var(--aw-bg-2)]/40 transition-colors text-left"
    >
      {open
        ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
        : <ChevronRight className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />}
      <span className="shrink-0 text-[var(--aw-text-3)] [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      <span className="text-[11px] font-medium text-[var(--aw-text-1)]">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-[var(--aw-text-4)]">({count})</span>
      )}
      <span className="flex-1" />
      {trailing && <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{trailing}</span>}
    </button>
  );
}

// A static (non-collapsible) section header for content that's always
// shown when present, e.g. the primary payload of a cycle — mirrors
// CycleSectionHeader's shape minus the chevron/toggle.
export function CycleSectionLabel({ icon, label, count, trailing, tooltip }: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  trailing?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-[var(--aw-text-1)]">
      <span className="shrink-0 text-[var(--aw-text-3)] [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      {label}
      {count !== undefined && (
        <span className="text-[10px] text-[var(--aw-text-4)] font-normal">({count})</span>
      )}
      {tooltip && <InfoTooltip text={tooltip} />}
      {trailing && <span className="ml-auto text-[10px] text-[var(--aw-text-4)] font-normal">{trailing}</span>}
    </div>
  );
}

// Labeled value block for a recommendation/growth-opportunity's expanded
// detail — a small uppercase caption keeps each field scannable instead of
// running label and prose together on one line.
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--aw-text-3)] mb-1">{label}</div>
      <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{children}</div>
    </div>
  );
}

// Like Field, but boxed and tinted in `color` — used for the one field that
// should visually pop as "the fix" (a suggested/proposed change) rather than
// read as flat background information.
export function CalloutField({ label, children, color = 'var(--aw-purple-light)', icon }: {
  label: string;
  children: React.ReactNode;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded border p-2.5" style={{ borderColor: `${color}40`, background: `${color}0d` }}>
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color }}>
        {icon}
        {label}
      </div>
      <div className="text-[11px] text-[var(--aw-text-1)] leading-relaxed">{children}</div>
    </div>
  );
}

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--aw-red-bright)',
  high: 'var(--aw-orange-bright)',
  medium: 'var(--aw-yellow)',
  low: 'var(--aw-blue)',
};
