"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { ArrowUpRight, Boxes, ChartNoAxesCombined, ChevronDown, ChevronRight, Database, LayoutDashboard, MapPin, MessageSquareText, Settings2, Sparkles, Sprout, UsersRound } from "lucide-react";
import type { Dataset } from "../../../domain/dataset";
import { AiAccessControls } from "../ai-workbench";
import { SproutBrand } from "./brand";
import "./workspace-shell.css";

const pages = [
  { href: "/tactical", label: "Floor Plan", icon: LayoutDashboard },
  { href: "/tactical/reviews", label: "Customer Reviews & Social Media", icon: MessageSquareText },
  { href: "/tactical/hr", label: "HR", title: "People & operations", icon: UsersRound },
  { href: "/tactical/supply", label: "Supply Management", icon: Boxes },
  { href: "/tactical/finance", label: "Financial Intelligence", icon: ChartNoAxesCombined },
  { href: "/tactical/ai", label: "AI Assistant", icon: Sparkles },
];

export function WorkspaceShell({ profile, dataSource, revision, dirty, children }: {
  profile: Dataset["profile"]; dataSource: string; revision: number | null; dirty: boolean; children: ReactNode;
}) {
  const pathname = usePathname();
  const current = pages.find(page => page.href === pathname);
  const title = current?.title ?? current?.label ?? "Photo floor plan";
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPath = useRef(pathname);
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const accessArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    heading.current?.focus({ preventScroll: true });
    if (sourceDetails.current) sourceDetails.current.open = false;
    accessArea.current?.querySelector("details")?.removeAttribute("open");
  }, [pathname]);

  function guardLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (dirty && !window.confirm("Leave Tactical and discard unsaved layout changes?")) event.preventDefault();
  }

  return <div className="tactical-workspace sprout-theme sprout-shell">
    <a className="sprout-skip" href="#tactical-content">Skip to content</a>
    <aside className="sprout-sidebar" aria-label="Restaurant workspace">
      <div className="sprout-sidebar-brand"><SproutBrand onClick={guardLeave} /></div>
      <div className="sprout-restaurant">
        <div className="sprout-restaurant-mark"><Sprout size={23} aria-hidden="true" /></div>
        <div><span className="sprout-small-label">Your restaurant</span><h2>{profile.name}</h2></div>
        <p>{profile.cuisine}</p><span className="sprout-location"><MapPin size={12} aria-hidden="true" />{profile.location}</span>
      </div>
      <span className="sprout-nav-label">Manage restaurant</span>
      <nav className="sprout-sections" aria-label="Tactical sections">
        {pages.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={href === "/tactical/ai" ? "sprout-ai-link" : undefined}>
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>{pathname === href && <span className="sprout-current-dot" aria-hidden="true" />}
        </Link>)}
      </nav>
      <div className="sprout-sidebar-bottom">
        <nav className="sprout-expansion" aria-label="Workspace"><span className="sprout-small-label">Your next chapter</span><Link href="/expansion" onClick={guardLeave}><MapPin size={17} aria-hidden="true" />Explore expansion<ArrowUpRight size={16} aria-hidden="true" /></Link></nav>
        <Link href="/onboarding" className="sprout-setup-link" onClick={guardLeave}><Settings2 size={16} aria-hidden="true" />Restaurant setup</Link>
        <p className="sprout-sidebar-motto">Small business.<br />Bigger possibilities.</p>
      </div>
    </aside>
    <div className="sprout-workspace-body">
      <header className="sprout-topbar">
        <div className="sprout-breadcrumb"><span>{profile.name}</span><ChevronRight size={13} aria-hidden="true" /><span>Manage restaurant</span></div>
        <details className="sprout-source" ref={sourceDetails} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary><span className="sprout-demo-dot" />Demo data<ChevronDown size={13} aria-hidden="true" /></summary>
          <div className="sprout-source-panel"><Database size={18} aria-hidden="true" /><strong>Restaurant data</strong><dl><div><dt>Source</dt><dd>{dataSource}</dd></div><div><dt>Restaurant</dt><dd>{profile.name}</dd></div><div><dt>Storage</dt><dd>{revision !== null ? "MongoDB" : "Local mock fixture"}</dd></div>{revision !== null && <div><dt>Revision</dt><dd>{revision}</dd></div>}</dl><p>Fictional restaurant data. Saved changes remain in their existing browser or database storage.</p></div>
        </details>
      </header>
      <main className="sprout-main" id="tactical-content" tabIndex={-1}>
        <div className="sprout-page-heading"><div><span className="sprout-small-label">Your workspace</span><h1 ref={heading} tabIndex={-1}>{title}</h1></div>
          {pathname !== "/tactical" && pathname !== "/tactical/supply" && <div className="sprout-access" ref={accessArea} onKeyDown={event => { if (event.key === "Escape") { const details = event.currentTarget.querySelector("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } } }}><AiAccessControls /></div>}
        </div>
        {children}
      </main>
    </div>
  </div>;
}
