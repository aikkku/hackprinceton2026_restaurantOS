"use client";

import { Building2, Sprout } from "lucide-react";
import type { ReactNode } from "react";
import { FIT_ICON, FIT_LABEL, type Fit } from "./model.ts";

export function Header({ exampleName }: { exampleName: string | null }) {
  return (
    <header className="sx-header">
      <a className="sx-wordmark" href="/expansion" aria-label="sprout. Expansion home">sprout<span>.</span></a>
      <span className="sx-header-section">Expansion</span>
      <span className="sx-header-spacer" />
      <a className="sx-header-link" href="/tactical">Manage restaurant</a>
      {exampleName && <span className="sx-tag sx-tag-example" title="Fictional example profile; no real restaurant records">Example: {exampleName}</span>}
    </header>
  );
}

export function FitPill({ fit, label }: { fit: Fit; label?: string }) {
  return (
    <span className={`sx-pill sx-s-${fit}`}>
      <span className="sx-pill-icon" aria-hidden="true">{FIT_ICON[fit]}</span>
      {label ?? FIT_LABEL[fit]}
    </span>
  );
}

export function Dot({ fit, title }: { fit: Fit; title?: string }) {
  return <span className={`sx-dot sx-s-${fit}`} role="img" aria-label={title ?? FIT_LABEL[fit]}>{FIT_ICON[fit]}</span>;
}

export type TagKind = "listing" | "owner" | "estimate" | "unknown" | "example" | "followup";
export function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  return <span className={`sx-tag sx-tag-${kind}`}>{children}</span>;
}

export function Back({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className="sx-back" onClick={onClick}><span aria-hidden="true">‹</span> {children}</button>;
}

export function Disclosure({ title, hint, children, open, onToggle, last }: {
  title: ReactNode; hint?: ReactNode; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void; last?: boolean;
}) {
  return (
    <details className={`sx-details${last ? " sx-details-group" : ""}`} open={open} onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>{title}{hint !== undefined && <span className="sx-details-count">{hint}</span>}</summary>
      <div className="sx-details-body">{children}</div>
    </details>
  );
}

export function AskButton({ onClick, label = "Ask Sprout about this" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="sx-ask" onClick={onClick}>
      <span className="sx-ask-dot" aria-hidden="true"><Sprout size={16} /></span>{label}
    </button>
  );
}

export function Thumb({ src, alt, variant }: { src?: string | null; alt: string; variant?: "hero" | "wide" | "reco" }) {
  return (
    <span className={`sx-thumb${variant ? ` sx-thumb-${variant}` : ""}`} role="img" aria-label={src ? alt : `${alt} (no photo available)`}>
      {/* Native img keeps permitted provider bytes on our own route; no third-party optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : <Building2 size={variant === "hero" || variant === "wide" ? 40 : 30} strokeWidth={1.4} aria-hidden="true" />}
    </span>
  );
}

export function QuestionShell({ step, total, title, hint, children, actions, onSubmit }: {
  step: number; total: number; title: string; hint?: ReactNode; children: ReactNode; actions: ReactNode; onSubmit: () => void;
}) {
  return (
    <form className="sx-q" onSubmit={(event) => { event.preventDefault(); onSubmit(); }} noValidate>
      <div className="sx-q-progress" aria-label={`Question ${step} of ${total}`}>
        <span>{step} of {total}</span>
        <span className="sx-q-bar" aria-hidden="true"><span style={{ width: `${(step / total) * 100}%` }} /></span>
      </div>
      <div className="sx-stack">
        <h1 className="sx-q-title">{title}</h1>
        {hint && <p className="sx-muted">{hint}</p>}
      </div>
      {children}
      <div className="sx-q-actions">{actions}</div>
    </form>
  );
}

export function MoneyInput({ label, value, onChange, prefix = "$", suffix, small, autoFocus, id, step = "any" }: {
  label: string; value: string; onChange: (value: string) => void; prefix?: string; suffix?: string; small?: boolean; autoFocus?: boolean; id?: string; step?: string;
}) {
  return (
    <label className={`sx-input${small ? " sx-input-sm" : ""}`}>
      <span className="sx-sr">{label}</span>
      {prefix && <span className="sx-input-affix" aria-hidden="true">{prefix}</span>}
      <input id={id} inputMode="decimal" type="text" autoComplete="off" value={value} autoFocus={autoFocus}
        data-step={step} onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))} />
      {suffix && <span className="sx-input-affix" aria-hidden="true">{suffix}</span>}
    </label>
  );
}

/** "5,000" → 5000; blank → null; anything else → NaN (caller reports). */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

export const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

export function Loading({ children }: { children: ReactNode }) {
  return <div className="sx-loading" role="status"><span className="sx-spinner" aria-hidden="true" />{children}</div>;
}
