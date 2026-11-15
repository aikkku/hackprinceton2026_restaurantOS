"use client";
import type { Layout } from "../../domain/schemas";
import { AiWorkbench } from "./ai-workbench";
export function AiAssistant({ restaurantId, layout }: { restaurantId: string; layout: Layout }) {
  return <AiWorkbench title="AI restaurant advisor" description="Ask about the current floor plan, customer feedback, menu costs, stock or recorded finances. Each answer uses the current Tactical context; Expansion data and external research are unavailable." inputLabel="Ask your restaurant advisor" request={{ task: "advisor", restaurantId, layout, question: "" }} />;
}
