"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "../../domain/dataset";
import { modernFloorLibrary } from "../../domain/floor-editor";
import { FloorEditor, type FloorContext } from "./floor-editor";
import { ReviewInsights } from "./review-insights";
import { HrPage } from "./hr-page";
import { SupplyPage } from "./supply-page";
import { FinancePage } from "./finance-page";
import { AiAssistant } from "./ai-assistant";
import { AnalyzePlan } from "./analyze-plan";
import { AiAccessProvider } from "./ai-workbench";
import { WorkspaceShell } from "./sprout/workspace-shell";
import { AssistantLocationContext, AssistantLocationEffect, type AssistantLocation } from "../assistant-navigation";
import type { AssistantTarget } from "../../domain/assistant";
import "./tactical.css";

export function TacticalWorkspace({ fixture, dataSource, revision }: { fixture: Dataset; dataSource: string; revision: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.split("/")[2] ?? "floor";
  const [current, setCurrent] = useState({ dataset: fixture, revision: revision ?? 0 });
  const data = current.dataset;
  const [location, setLocation] = useState<AssistantLocation | null>(null);
  const [notice, setNotice] = useState("");
  const acceptDataset = useCallback((dataset: Dataset, nextRevision: number) => {
    setCurrent(previous => nextRevision >= previous.revision ? { dataset, revision: nextRevision } : previous);
  }, []);
  const locate = useCallback((target: AssistantTarget) => {
    setLocation({ target, nonce: Date.now() }); setNotice(target.label);
    router.push(target.page === "floor" ? "/tactical" : `/tactical/${target.page}`);
  }, [router]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6500); return () => clearTimeout(timer); }, [notice, location]);
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
    <AiAccessProvider enabled={section !== "supply"} renderControls={false}>
      <WorkspaceShell profile={data.profile} dataSource={dataSource} revision={revision === null ? null : current.revision} dirty={context.dirty}>
      <AssistantLocationContext.Provider value={location}>
        <AssistantLocationEffect location={location} section={section}/>
        <div hidden={section !== "floor"}>
          <FloorEditor template={fixture.layout} saved={fixture.layoutConfigurations} cloud={revision !== null}
            analysisRequested={section === "floor" ? analysisRequested : 0} onContext={setContext} />
        </div>
        {section === "analyze" && <AnalyzePlan plans={fixture.photoPlans} />}
        <div hidden={section !== "reviews"}>
        <ReviewInsights restaurantId={fixture.profile.id} reviews={data.reviews} active={section === "reviews"} onTrySeating={openSeatingAnalysis} />
        </div>
        <div hidden={section !== "hr"}>
          <HrPage dataset={data} active={section === "hr"} />
        </div>
        <div hidden={section !== "supply"}>
          <SupplyPage operations={data.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "finance"}>
          <FinancePage dataset={data} active={section === "finance"} cloudEnabled={revision !== null} />
        </div>
        <div hidden={section !== "ai"}>
          <AiAssistant dataset={data} layout={context.layout} layoutVersions={context.library} active={section === "ai"} onDataset={acceptDataset} onLocate={locate} />
        </div>
        {notice && section !== "ai" && <div className="assistant-location-notice" role="status"><span>Located: {notice}</span><button onClick={() => { router.push("/tactical/ai"); setNotice(""); }}>Back to chat</button><button aria-label="Dismiss location notice" onClick={() => setNotice("")}>×</button></div>}
      </AssistantLocationContext.Provider>
      </WorkspaceShell>
    </AiAccessProvider>
  );
}
