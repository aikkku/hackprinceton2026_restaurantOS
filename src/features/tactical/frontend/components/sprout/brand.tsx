import Link from "next/link";
import type { MouseEventHandler } from "react";
import "./primitives.css";

export function SproutBrand({ onClick }: { onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return <Link className="sprout-brand" href="/" aria-label="sprout. home" onClick={onClick}>
    <svg viewBox="0 0 40 40" width="38" height="38" fill="none" aria-hidden="true">
      <path d="M7 17v16a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V17M4 15 9 5h22l5 10c0 6-8 6-8 0 0 6-8 6-8 0 0 6-8 6-8 0 0 6-8 6-8 0Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M20 31v-6c-6 0-8-5-8-5 6-1 8 3 8 5 0-5 4-7 9-7-1 6-5 8-9 7" fill="currentColor" />
    </svg>
    <span>sprout<span className="sprout-brand-dot">.</span></span>
  </Link>;
}
