import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assistantRequestSchema, assistantPlanSchema, conversationSchema, applyAssistantProposal, assistantSuggestions, type AssistantMessage } from "../../domain/assistant.ts";
import { authorizedAi, boundedJson, sameOrigin, aiFailure, takeAiBudget } from "../ai-access.ts";
import { aiModel, generateStructured } from "../gemini.ts";
import { assistantRepository, AssistantConflict, type AssistantRepository } from "./repository.ts";
import { executeAssistantTools, assistantSystem } from "./tools.ts";
import { buildFinanceReport } from "../../domain/finance-report.ts";
import { modernFloor, modernFloorLibrary } from "../../domain/floor-editor.ts";
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export function createAssistantHandler(dependencies: { repository?: () => AssistantRepository; generate?: typeof generateStructured; authorize?: typeof authorizedAi; budget?: typeof takeAiBudget } = {}) {
  const repository = dependencies.repository ?? assistantRepository, generate = dependencies.generate ?? generateStructured, authorize = dependencies.authorize ?? authorizedAi, budget = dependencies.budget ?? takeAiBudget;
  let running = 0;
  return async (request: Request) => {
    if (!authorize(request)) return aiFailure(401);
    if (request.method !== "GET" && !sameOrigin(request)) return aiFailure(403);
    try {
      const store = repository(), record = await store.dataset(), dataset = record.dataset;
      if (request.method === "GET") {
        const url = new URL(request.url);
        if (url.searchParams.get("restaurantId") !== dataset.profile.id) return aiFailure(403);
        const id = url.searchParams.get("threadId");
        if (id) {
          const thread = await store.read(z.uuid().parse(id), dataset.profile.id);
          return thread ? json({ ok: true, thread, storage: store.storage, dataset, datasetRevision: record.revision }) : aiFailure(404);
        }
        return json({ ok: true, threads: await store.list(dataset.profile.id), suggestions: assistantSuggestions(dataset), storage: store.storage, dataset, datasetRevision: record.revision });
      }
      const input = assistantRequestSchema.parse(await boundedJson(request, 1024 * 1024));
      if (input.restaurantId !== dataset.profile.id) return aiFailure(403);
      const thread = await store.read(input.threadId, dataset.profile.id);
      if (input.action === "apply") {
        if (!thread) return aiFailure(404);
        const message = thread.messages.find(row => row.id === input.messageId && row.role === "assistant");
        const proposal = message?.proposals.find(row => row.id === input.proposalId);
        if (!proposal) return aiFailure(404);
        if (proposal.status === "applied") return json({ ok: true, thread, dataset, datasetRevision: record.revision, storage: store.storage });
        if (proposal.datasetRevision !== record.revision) throw new AssistantConflict();
        const updated = applyAssistantProposal(dataset, proposal, input.value);
        const now = new Date().toISOString(), next = structuredClone(thread);
        const accepted = next.messages.find(row => row.id === input.messageId)!.proposals.find(row => row.id === input.proposalId)!;
        accepted.status = "applied"; accepted.value = input.value; accepted.appliedAt = now;
        next.revision++; next.updatedAt = now;
        await store.apply(next, thread.revision, { ...record, dataset: updated, revision: record.revision + 1, updatedAt: now }, record.revision);
        return json({ ok: true, thread: next, dataset: updated, datasetRevision: record.revision + 1, storage: store.storage, target: accepted.target });
      }
      const duplicate = thread?.messages.find(row => row.id === input.messageId && row.role === "user");
      if (duplicate) {
        if (duplicate.text !== input.text) return aiFailure(409);
        return json({ ok: true, thread, storage: store.storage, dataset, datasetRevision: record.revision, replayed: true });
      }
      if (thread && thread.messages.length >= 60) return aiFailure(409);
      if (input.layout?.restaurantId !== undefined && input.layout.restaurantId !== dataset.profile.id || input.layoutVersions?.entries.some(entry => entry.layout.restaurantId !== dataset.profile.id)) return aiFailure(403);
      if (running >= 2 || !budget("generate")) return aiFailure(429);
      running++;
      try {
        const layout = modernFloor(input.layout ?? dataset.layoutConfigurations.entries.find(entry => entry.id === dataset.layoutConfigurations.activeId)!.layout);
        const report = buildFinanceReport(dataset);
        const context = {
          restaurant: dataset.profile, source: dataset.provenance, revision: record.revision,
          inventory: dataset.operations.inventory, menu: dataset.operations.menu,
          employees: dataset.operations.employees.map(({ id, name, role, hoursThisWeek, hourlyRateCents }) => ({ id, name, role, hoursThisWeek, hourlyRateCents })),
          reviews: dataset.reviews.slice(0, 50), financePeriod: dataset.operations.financeReport ? { start: dataset.operations.financeReport.startDate, end: dataset.operations.financeReport.endDate, soldMenuIds: dataset.operations.financeReport.sales.filter(row => row.dineInUnits > 0).map(row => row.menuItemId) } : null,
          financialMetrics: report ? { revenueCents: report.revenueCents, contributionCents: report.contributionCents, appFeesCents: report.delivery.feesCents, appContributionCents: report.delivery.contributionCents, slowItems: report.slow.map(row => ({ id: row.menuItemId, netIfCutCents: row.netIfCutCents })), limitations: "Synthetic historical sample. Contribution excludes labor, fixed costs and tax. Current menu edits do not rewrite historical sales prices." } : null,
          workingLayout: layout, savedVersions: modernFloorLibrary(input.layoutVersions ?? dataset.layoutConfigurations),
        };
        const history = thread?.messages.slice(-10).map(({ role, text, targets, proposals, blocks }) => ({ role, text, targets, proposals, results: blocks.map(block => ({ type: block.type, title: block.title })) }));
        const prompt = JSON.stringify({ context, history, request: input.text });
        if (prompt.length > 220_000) return aiFailure(413);
        const plan = assistantPlanSchema.parse(await generate(assistantPlanSchema, assistantSystem, prompt, { signal: request.signal }));
        // Numeric values belong to canonical tool cards, not model-written finance prose.
        const names = [...dataset.operations.inventory, ...dataset.operations.menu, ...dataset.operations.employees].map(row => row.name).sort((a, b) => b.length - a.length);
        const prose = names.reduce((value, name) => value.split(name).join(""), plan.message);
        if (/[\d$€£%]/.test(prose)) throw new Error("Numeric narration");
        const result = executeAssistantTools(plan, dataset, record.revision, layout);
        const now = new Date().toISOString();
        const user: AssistantMessage = { id: input.messageId, role: "user", text: input.text, createdAt: now, blocks: [], proposals: [], targets: [], navigate: false, datasetRevision: record.revision, model: null };
        const answer: AssistantMessage = { id: randomUUID(), role: "assistant", text: plan.message, createdAt: now, ...result, navigate: plan.navigate && result.targets.length === 1 && result.proposals.length === 0, datasetRevision: record.revision, model: aiModel() };
        const next = conversationSchema.parse({ id: input.threadId, restaurantId: dataset.profile.id, title: thread?.title ?? input.text.slice(0, 80), revision: (thread?.revision ?? 0) + 1, createdAt: thread?.createdAt ?? now, updatedAt: now, messages: [...(thread?.messages ?? []), user, answer] });
        if (Buffer.byteLength(JSON.stringify(next)) > 4 * 1024 * 1024) return aiFailure(413);
        await store.save(next, thread?.revision ?? 0);
        return json({ ok: true, thread: next, storage: store.storage, dataset, datasetRevision: record.revision });
      } finally { running--; }
    } catch (error) {
      if (error instanceof AssistantConflict) return Response.json({ ok: false, error: "The data changed. Ask for a fresh preview before applying.", code: "conflict" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return aiFailure();
    }
  };
}
