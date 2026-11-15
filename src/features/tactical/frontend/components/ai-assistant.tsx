"use client";
import type { Layout } from "../../domain/schemas";
import type { LayoutLibrary } from "../../domain/layout-library";
import { AiWorkbench } from "./ai-workbench";
export function AiAssistant({ restaurantId, layout, layoutVersions }: { restaurantId: string; layout: Layout; layoutVersions: LayoutLibrary }) {
  return <AiWorkbench title="AI restaurant advisor" description="Ask about the current floor plan, saved plan versions, customer feedback, menu costs, stock or recorded finances." inputLabel="Ask your restaurant advisor" request={{ task: "advisor", restaurantId, layout, layoutVersions, question: "" }} />;
}
