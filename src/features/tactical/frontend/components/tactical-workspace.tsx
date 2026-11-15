"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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
import "./tactical.css";

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
    <AiAccessProvider enabled={section !== "supply"} renderControls={false}>
      <WorkspaceShell profile={fixture.profile} dataSource={dataSource} revision={revision} dirty={context.dirty}>
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
          <SupplyPage operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "finance"}>
          <FinancePage dataset={fixture} active={section === "finance"} cloudEnabled={revision !== null} />
        </div>
        <div hidden={section !== "ai"}>
          <AiAssistant restaurantId={fixture.profile.id} layout={context.layout} layoutVersions={context.library} />
        </div>
      </WorkspaceShell>
    </AiAccessProvider>
  );
}
