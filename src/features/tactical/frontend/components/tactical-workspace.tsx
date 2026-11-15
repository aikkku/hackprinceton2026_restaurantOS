"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import type { Dataset } from "../../domain/dataset";
import { modernFloorLibrary } from "../../domain/floor-editor";
import { FloorEditor, type FloorContext } from "./floor-editor";
import { ReviewInsights } from "./review-insights";
import { HrPage } from "./hr-page";
import { SupplyPage } from "./supply-page";
import { FinancePage } from "./finance-page";
import { AiAssistant } from "./ai-assistant";
import { AnalyzePlan } from "./analyze-plan";
import { AiAccessProvider, AiWorkbench } from "./ai-workbench";
import "./tactical.css";

const pages = [
  ["/tactical", "Floor Plan"],
  ["/tactical/reviews", "Customer Reviews & Social Media"],
  ["/tactical/hr", "HR"],
  ["/tactical/supply", "Supply Management"],
  ["/tactical/finance", "Financial Intelligence"],
  ["/tactical/ai", "AI Assistant"],
];

export function TacticalWorkspace({ fixture, dataSource, revision }: { fixture: Dataset; dataSource: string; revision: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.split("/")[2] ?? "floor";
  const [analysisRequested, setAnalysisRequested] = useState(0);
  const [context, setContext] = useState<FloorContext>(() => {
    const library = modernFloorLibrary(fixture.layoutConfigurations);
    return { library, layout: library.entries.find(entry => entry.id === library.activeId)!.layout, dirty: false };
  });

  function openSeatingAnalysis() {
    router.push("/tactical");
    setAnalysisRequested(count => count + 1);
  }

  return (
    <div className="tactical-workspace">
      <header className="app-bar">
        <div className="app-bar-inner">
          <a className="brand" href="/tactical"><span className="brand-icon"><UtensilsCrossed size={19} /></span>RestaurantOS</a>
          <nav className="workspace-switch" aria-label="Workspace">
            <span className="current-mode" aria-current="page">Manage restaurant</span>
            <Link href="/expansion" onClick={(event) => {
              if (context.dirty && !window.confirm("Leave Tactical and discard unsaved layout changes?")) event.preventDefault();
            }}>Explore expansion</Link>
          </nav>
          <span className="demo-badge">Demo · {dataSource}{revision !== null ? ` · revision ${revision}` : ""}</span>
        </div>
      </header>
      <main className="workspace-main">
        <div className="restaurant-heading">
          <div><h1>{fixture.profile.name}</h1><p>{fixture.profile.cuisine} · {fixture.profile.location}</p></div>
        </div>

        <nav className="workspace-links" aria-label="Tactical sections">
          {pages.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}
        </nav>
        <AiAccessProvider renderControls={section !== "floor"}>
        <div hidden={section !== "floor"}>
          <FloorEditor template={fixture.layout} saved={fixture.layoutConfigurations} cloud={revision !== null}
            analysisRequested={section === "floor" ? analysisRequested : 0} onContext={setContext} />
        </div>
        {section === "analyze" && <AnalyzePlan plans={fixture.photoPlans} />}
        <div hidden={section !== "reviews"}>
        <ReviewInsights restaurantId={fixture.profile.id} reviews={fixture.reviews} active={section === "reviews"} onTrySeating={openSeatingAnalysis} />
        </div>
        <div hidden={section !== "hr"}>
          <HrPage dataset={fixture} active={section === "hr"} />
        </div>
        <div hidden={section !== "supply"}>
          <AiWorkbench title="AI supply advisor" description="Explain stock issues and code-calculated costs to reach reorder thresholds. These are planning suggestions, not purchase orders." request={{ task: "supply", restaurantId: fixture.profile.id, question: "" }} />
          <SupplyPage operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "finance"}>
          <AiWorkbench title="AI financial analysis" description="Explain the full supplied ledger and menu contribution calculations. This uses the dataset totals, not the filters or unsaved price experiment below." request={{ task: "finance", restaurantId: fixture.profile.id, question: "" }} />
          <FinancePage assumptions={fixture.assumptions} operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "ai"}>
          <AiAssistant restaurantId={fixture.profile.id} layout={context.layout} layoutVersions={context.library} />
        </div>
        </AiAccessProvider>
      </main>
    </div>
  );
}
