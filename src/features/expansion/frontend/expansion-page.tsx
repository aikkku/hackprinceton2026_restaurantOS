"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateDecisionFinance, emptyFinanceInputs, type DecisionFinanceInputs } from "../domain/decision-finance.ts";
import { createDecisionBrief, type BriefChoice, type DecisionBrief } from "../domain/decision-brief.ts";
import { reassessCandidate, type InvestigationNote, type SourceSnapshot } from "../domain/evidence.ts";
import type { AssessedCandidate } from "../domain/matching.ts";
import { BRIEF_STORAGE_KEY, decodeBriefs, persistBriefs } from "./brief-storage.ts";
import { ensureSession, listAccountBriefs, loadAccountProfile, saveAccountBrief, saveAccountProfile, unlockSession, type SessionStatus } from "./data/account-client.ts";
import { refreshCandidateSources } from "./data/investigation-client.ts";
import { formFromRevision, type FormState } from "./profile-form.ts";
import {
  PROFILE_DRAFT_STORAGE_KEY, currentProfileRevision, decodeProfileDraft, persistProfileDraft, profileDraftEnvelopeSchema, resetProfileDraft,
  type ProfileDraftEnvelope, type ProfileDraftStatus,
} from "./storage.ts";
import { AskDrawer, type AskContext } from "./sprout/ask.tsx";
import { Compare } from "./sprout/compare.tsx";
import { CostResults, CostWizard, costSteps, type CostKey } from "./sprout/costs.tsx";
import { Home, type PlanEntry } from "./sprout/home.tsx";
import { checkQuestion, costLabel, fitForGroup, makeChoice, monthlyCost, numberRequirement, rangeLabel, FIT_LABEL } from "./sprout/model.ts";
import { NeedsReview, NeedsWizard } from "./sprout/needs.tsx";
import { PlaceDetail } from "./sprout/place-detail.tsx";
import { Places, type PlaceView } from "./sprout/places.tsx";
import { Plan, biggestConcern, nextQuestionsFor } from "./sprout/plan.tsx";
import { effectiveIntake, exampleEnvelope, reviseFromForm } from "./sprout/profile.ts";
import { SearchProgress } from "./sprout/search.tsx";
import { MAX_SAVED_PLACES, choicesToKeep, clearSearchSession, readSearchSession, writeSearchSession, type SearchSession } from "./sprout/session.ts";
import { Header, Loading } from "./sprout/ui.tsx";
import { loadAgentWorkspace, loadDeterministicWorkspace, workspaceFromBrief, type Workspace } from "./sprout/workspace.ts";
import "./sprout/sprout.css";

type Screen =
  | { name: "boot" }
  | { name: "home" }
  | { name: "needs"; step: number; returnToReview: boolean }
  | { name: "review" }
  | { name: "search"; attempt: number }
  | { name: "loading"; message: string; error?: string; retry?: () => void }
  | { name: "places" }
  | { name: "place"; id: string }
  | { name: "compare" }
  | { name: "costs"; step: number }
  | { name: "costResults" }
  | { name: "plan" };

const CITY_ID = "houston";
const errorText = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback);

export default function ExpansionPage() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [draft, setDraft] = useState<ProfileDraftStatus>({ status: "empty" });
  const [envelope, setEnvelope] = useState<ProfileDraftEnvelope | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [account, setAccount] = useState<SessionStatus | null>(null);
  const [homeNotice, setHomeNotice] = useState("");
  const [review, setReview] = useState({ busy: false, error: "" });
  const [searchProfile, setSearchProfile] = useState<{ revisionId: string; revisionNumber: number; intake: ReturnType<typeof effectiveIntake> } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [choices, setChoices] = useState<Record<string, BriefChoice>>({});
  const [saved, setSaved] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placeState, setPlaceState] = useState({ busy: false, notice: "", error: "" });
  const [listNotice, setListNotice] = useState("");
  const [browserBriefs, setBrowserBriefs] = useState<DecisionBrief[]>([]);
  const [briefStorageBlocked, setBriefStorageBlocked] = useState(false);
  const [accountBriefs, setAccountBriefs] = useState<DecisionBrief[]>([]);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const [planState, setPlanState] = useState({ saving: false, notice: "", error: "" });
  const [ask, setAsk] = useState<AskContext | null>(null);
  const [resume, setResume] = useState<SearchSession | null>(null);
  const loadGeneration = useRef(0);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    void Promise.resolve().then(async () => {
      let local: ProfileDraftStatus = { status: "empty" };
      try {
        local = decodeProfileDraft(localStorage.getItem(PROFILE_DRAFT_STORAGE_KEY));
        const briefs = decodeBriefs(localStorage.getItem(BRIEF_STORAGE_KEY));
        if (briefs.status === "ok") setBrowserBriefs(briefs.briefs); else setBriefStorageBlocked(true);
        setResume(readSearchSession(localStorage));
      } catch { setBriefStorageBlocked(true); }
      setDraft(local);
      if (local.status === "ok") setEnvelope(local.envelope);
      // Home never waits on the private workspace store; it fills in when it answers.
      setScreen({ name: "home" });
      const status = await ensureSession().catch(() => null);
      setAccount(status);
      if (!status?.authenticated) return;
      void listAccountBriefs().then((result) => setAccountBriefs(result.briefs.map((record) => record.brief))).catch(() => undefined);
      if (local.status !== "empty") return;
      const remote = await loadAccountProfile().catch(() => null);
      const parsed = remote?.envelope ? profileDraftEnvelopeSchema.safeParse(remote.envelope) : null;
      // Only adopt the workspace copy if the owner hasn't started editing here meanwhile.
      if (parsed?.success) {
        setEnvelope((current) => current ?? parsed.data);
        setDraft((current) => (current.status === "empty" ? { status: "ok", envelope: parsed.data } : current));
      }
    });
  }, []);

  const screenKey = screen.name === "needs" || screen.name === "costs" ? `${screen.name}:${screen.step}` : screen.name === "place" ? `place:${screen.id}` : screen.name;
  useEffect(() => { if (screenKey !== "boot") window.scrollTo({ top: 0 }); }, [screenKey]);

  /** Home re-reads the resumable search pointer so "Continue" is current. */
  const goHome = () => {
    try { setResume(readSearchSession(localStorage)); } catch { /* storage optional */ }
    setScreen({ name: "home" });
  };

  const revision = envelope ? currentProfileRevision(envelope) : null;
  const exampleName = revision?.isDemo ? revision.intakeSnapshot.restaurant.name : workspace?.bundle?.profile.intake.isDemo ? workspace.restaurantName : null;

  const plans = useMemo<PlanEntry[]>(() => {
    const inWorkspace = new Set(accountBriefs.map((brief) => brief.id));
    return [
      ...accountBriefs.map((brief) => ({ brief, where: "workspace" as const })),
      ...browserBriefs.filter((brief) => !inWorkspace.has(brief.id)).map((brief) => ({ brief, where: "browser" as const })),
    ].sort((a, b) => b.brief.createdAt.localeCompare(a.brief.createdAt));
  }, [accountBriefs, browserBriefs]);

  // ------------------------------------------------------------ profile
  const startNeeds = () => {
    const working = envelope ?? exampleEnvelope();
    setEnvelope(working);
    setForm(formFromRevision(currentProfileRevision(working)));
    setReview({ busy: false, error: "" });
    setScreen({ name: "needs", step: 0, returnToReview: false });
  };

  /** Save the needs as a profile revision (browser + workspace). Returns the revision to search with. */
  const commitNeeds = () => {
    if (!envelope || !form) return null;
    const result = reviseFromForm(envelope, form);
    if (!result.ok) { setReview({ busy: false, error: result.message }); return null; }
    const stored = draft.status === "ok" && draft.envelope.updatedAt === result.envelope.updatedAt;
    if (!result.changed && stored) return result.revision;
    try {
      persistProfileDraft(localStorage, result.envelope);
    } catch {
      setReview({ busy: false, error: "Your browser storage is full or blocked, so your needs couldn’t be saved here. Nothing was lost on screen." });
    }
    setEnvelope(result.envelope);
    setDraft({ status: "ok", envelope: result.envelope });
    void saveAccountProfile(result.envelope).catch(() => undefined);
    return result.revision;
  };

  const findLocations = () => {
    const next = commitNeeds();
    if (!next) return;
    setSearchProfile({ revisionId: next.revisionId, revisionNumber: next.revisionNumber, intake: effectiveIntake(next) });
    setScreen((old) => ({ name: "search", attempt: (old.name === "search" ? old.attempt : 0) + 1 }));
  };

  // ---------------------------------------------------------- workspace
  async function openWorkspace(load: () => Promise<Workspace>, message: string, restore?: SearchSession | null) {
    const generation = ++loadGeneration.current;
    const attempt = () => { void openWorkspace(load, message, restore); };
    setScreen({ name: "loading", message });
    try {
      const next = await load();
      if (generation !== loadGeneration.current) return;
      const restored: Record<string, BriefChoice> = {};
      if (restore && restore.runId === next.runId) {
        for (const choice of restore.choices) {
          const base = next.candidates.find((item) => item.candidate.id === choice.candidateId);
          if (base && choice.assessment.profileRevisionId === next.requirements.revisionId && JSON.stringify(base.candidate) === JSON.stringify(choice.assessment.candidate)) restored[choice.candidateId] = choice;
        }
      }
      const ids = new Set(next.candidates.map((item) => item.candidate.id));
      setWorkspace(next);
      setChoices(restored);
      setSaved(restore ? restore.saved.filter((id) => ids.has(id)) : []);
      setPick(restore?.pick && ids.has(restore.pick) ? restore.pick : null);
      setSelectedId(null);
      setRestoredFrom(null);
      setListNotice("");
      setPlanState({ saving: false, notice: "", error: "" });
      setScreen({ name: "places" });
    } catch (failure) {
      if (generation !== loadGeneration.current) return;
      setScreen({ name: "loading", message, error: errorText(failure, "We couldn’t load these places."), retry: attempt });
    }
  }

  // Keep a resumable pointer to the live search (never for saved-plan snapshots).
  useEffect(() => {
    if (!workspace || workspace.source === "saved_plan") return;
    const session: SearchSession = {
      version: 1, source: workspace.source, runId: workspace.runId, cityLabel: workspace.cityLabel, placesFound: workspace.candidates.length,
      profileRevisionId: workspace.requirements.revisionId, saved, pick, choices: choicesToKeep(choices, saved, pick).slice(0, 20), updatedAt: new Date().toISOString(),
    };
    try { writeSearchSession(localStorage, session); } catch { /* storage optional */ }
  }, [workspace, saved, pick, choices]);

  const baseFor = useCallback((id: string) => workspace?.candidates.find((item) => item.candidate.id === id) ?? null, [workspace]);

  const choiceFor = useCallback((id: string): BriefChoice | null => {
    if (choices[id]) return choices[id];
    const base = baseFor(id);
    return base && workspace ? makeChoice(workspace.requirements, base, workspace.evidence.get(id)) : null;
  }, [choices, baseFor, workspace]);

  /** Materialize a choice into state (first open, save or cost answer). */
  const ensureChoice = (id: string): BriefChoice | null => {
    const choice = choiceFor(id);
    if (choice && !choices[id]) setChoices((old) => (old[id] ? old : { ...old, [id]: choice }));
    return choice;
  };

  const views = useMemo<PlaceView[]>(() => (workspace?.candidates ?? []).map((base) => {
    const choice = choices[base.candidate.id];
    const assessed: AssessedCandidate = choice ? { ...base, assessments: choice.assessment.assessments, group: choice.assessment.group } : base;
    const sources = choice?.assessment.sources ?? workspace?.evidence.get(base.candidate.id);
    return { assessed, image: sources?.observations.find((o) => o.imageUrl)?.imageUrl ?? null };
  }), [workspace, choices]);
  const imageFor = (id: string) => views.find((view) => view.assessed.candidate.id === id)?.image ?? null;

  const toggleSave = (id: string) => {
    if (saved.includes(id)) {
      setSaved((old) => old.filter((item) => item !== id));
      if (pick === id) setPick(null);
      setListNotice("");
      return;
    }
    if (saved.length >= MAX_SAVED_PLACES) { setListNotice(`You can save up to ${MAX_SAVED_PLACES} places. Remove one first.`); return; }
    ensureChoice(id);
    setSaved((old) => [...old, id]);
    setListNotice("");
  };

  const revise = (id: string, notes: InvestigationNote[], sources: SourceSnapshot) => {
    const base = baseFor(id);
    if (!base || !workspace) return;
    setChoices((old) => {
      const previous = old[id] ?? makeChoice(workspace.requirements, base, workspace.evidence.get(id));
      const assessment = reassessCandidate(base, workspace.requirements, notes, sources, { id: crypto.randomUUID(), parentId: previous.assessment.id, revisionNumber: previous.assessment.revisionNumber + 1, evaluatedAt: new Date().toISOString() });
      return { ...old, [id]: { ...previous, assessment, assessmentHistory: [...previous.assessmentHistory, previous.assessment] } };
    });
  };

  const refreshSources = async (id: string, mode: "live" | "synthetic") => {
    if (!workspace) return;
    const choice = ensureChoice(id);
    if (!choice) return;
    setPlaceState({ busy: true, notice: "", error: "" });
    try {
      const sources = await refreshCandidateSources(workspace.runId, id, { currentAddress: null, priceLevel: null, sourceMode: mode });
      revise(id, choice.assessment.notes, sources);
      const found = sources.observations.length;
      setPlaceState({ busy: false, error: "", notice: mode === "synthetic"
        ? "Loaded test source examples. They’re labeled as tests and can’t confirm a must-have."
        : found ? `Found ${found} new ${found === 1 ? "source" : "sources"}. We re-checked this place.` : "No new details were available. What we had is kept." });
    } catch {
      setPlaceState({ busy: false, notice: "", error: "We couldn’t reach the sources right now. What we had is kept. Try again later." });
    }
  };

  const applyFinance = (id: string, inputs: DecisionFinanceInputs) => {
    const base = baseFor(id);
    if (!base) return;
    setChoices((old) => {
      const previous = old[id] ?? choiceFor(id);
      if (!previous) return old;
      return { ...old, [id]: { ...previous, financeInputs: inputs, financeResults: calculateDecisionFinance(base.candidate, inputs) } };
    });
  };

  const resetFinance = (id: string) => {
    if (!workspace) return;
    const inputs = emptyFinanceInputs();
    inputs.totalFunds = numberRequirement(workspace.requirements, "funds.totalAvailable");
    const reserve = numberRequirement(workspace.requirements, "funds.emergencyReserve");
    inputs.reserve = reserve !== null && inputs.totalFunds !== null && reserve > inputs.totalFunds ? null : reserve;
    applyFinance(id, inputs);
  };

  const compareChoices = useMemo(() => saved.map((id) => choices[id] ?? choiceFor(id)).filter((c): c is BriefChoice => Boolean(c)), [saved, choices, choiceFor]);
  const planChoices = useMemo(() => {
    if (!pick) return compareChoices;
    const picked = choices[pick] ?? choiceFor(pick);
    return picked ? [picked, ...compareChoices.filter((c) => c.candidateId !== pick)] : compareChoices;
  }, [pick, compareChoices, choices, choiceFor]);

  // -------------------------------------------------------------- plans
  const savePlan = (title: string) => {
    if (!workspace?.bundle || !pick) return;
    setPlanState({ saving: true, notice: "", error: "" });
    try {
      const brief = createDecisionBrief({ id: crypto.randomUUID(), title, createdAt: new Date().toISOString(), parentBriefId: null, runSnapshot: workspace.bundle, choices: planChoices, nextQuestions: nextQuestionsFor(workspace, planChoices) });
      let inBrowser = false;
      if (!briefStorageBlocked) {
        try { const next = [brief, ...browserBriefs].slice(0, 10); persistBriefs(localStorage, next); setBrowserBriefs(next); inBrowser = true; } catch { inBrowser = false; }
      }
      if (inBrowser) setPlanState({ saving: false, error: "", notice: `Plan “${title}” saved on this browser. Saving to your workspace…` });
      void saveAccountBrief(brief).then(() => {
        setAccountBriefs((old) => [brief, ...old.filter((item) => item.id !== brief.id)]);
        setPlanState({ saving: false, error: "", notice: `Plan “${title}” saved to your workspace${inBrowser ? " and this browser" : ""}.` });
      }).catch((failure) => {
        if (inBrowser) setPlanState({ saving: false, error: "", notice: `Plan “${title}” saved on this browser. Your workspace couldn’t be reached (${errorText(failure, "unavailable")}).` });
        else setPlanState({ saving: false, notice: "", error: `The plan couldn’t be saved anywhere. It’s still on screen. ${errorText(failure, "")}` });
      });
    } catch (failure) {
      setPlanState({ saving: false, notice: "", error: errorText(failure, "The plan couldn’t be saved. It’s still on screen.") });
    }
  };

  const openPlan = (brief: DecisionBrief) => {
    loadGeneration.current += 1;
    setWorkspace(workspaceFromBrief(brief));
    setChoices(Object.fromEntries(brief.choices.map((choice) => [choice.candidateId, choice])));
    setSaved(brief.choices.map((choice) => choice.candidateId));
    setPick(brief.choices[0].candidateId);
    setRestoredFrom(brief.createdAt);
    setPlanState({ saving: false, notice: "", error: "" });
    setScreen({ name: "plan" });
  };

  // ---------------------------------------------------------------- ask
  const needsContext = () => workspace ? {
    restaurant: workspace.restaurantName, city: workspace.cityLabel, profileRevision: workspace.profileRevisionNumber,
    needs: workspace.requirements.requirements.filter((r) => r.state === "known").map((r) => ({ id: r.id, kind: r.kind, value: r.value })),
    propertyData: { datasetId: workspace.datasetId, datasetDate: workspace.datasetDate, synthetic: workspace.isSynthetic },
  } : null;
  const placeContext = (choice: BriefChoice) => ({
    id: choice.candidateId, name: choice.assessment.candidate.name, address: choice.assessment.candidate.address, suite: choice.assessment.candidate.suite,
    fit: FIT_LABEL[fitForGroup(choice.assessment.group)],
    monthlyCost: rangeLabel(choice.financeResults.occupancy, "/mo") ?? costLabel(monthlyCost(choice.assessment.candidate)),
    checks: choice.assessment.assessments.map((a) => ({ requirement: a.requirementId, status: a.status, reason: a.reason, recordSays: a.sourceValue })),
    stillToCheck: choice.assessment.assessments.map(checkQuestion).filter(Boolean),
  });
  const askAboutPlace = (id: string) => {
    const choice = choiceFor(id);
    if (!choice || !workspace) return;
    setAsk({ question: `Is ${choice.assessment.candidate.name} a good fit for ${workspace.restaurantName}?`, context: { topic: "property", ...needsContext(), place: placeContext(choice) } });
  };
  const askCompare = () => {
    if (!workspace) return;
    setAsk({ question: `Which place should ${workspace.restaurantName} look at first?`, context: { topic: "comparison", ...needsContext(), places: compareChoices.map(placeContext), pick } });
  };
  const askCosts = (id: string) => {
    const choice = choiceFor(id);
    if (!choice || !workspace) return;
    setAsk({ question: `What would it take for ${workspace.restaurantName} to open at ${choice.assessment.candidate.name}?`, context: { topic: "opening_costs", ...needsContext(), place: placeContext(choice), costInputs: choice.financeInputs, costResults: choice.financeResults } });
  };
  const askPlan = (choice: BriefChoice) => {
    if (!workspace) return;
    setAsk({ question: `What should ${workspace.restaurantName} do next about ${choice.assessment.candidate.name}?`, context: { topic: "plan", ...needsContext(), pick: placeContext(choice), biggestConcern: biggestConcern(choice, workspace), nextSteps: nextQuestionsFor(workspace, [choice]) } });
  };

  // ------------------------------------------------------------- render
  let body: React.ReactNode;
  switch (screen.name) {
    case "boot":
      body = <Loading>Getting things ready…</Loading>;
      break;
    case "home":
      body = <Home
        resume={resume ? { cityLabel: resume.cityLabel, placesFound: resume.placesFound, saved: resume.saved.length } : null}
        plans={plans}
        profileProblem={draft.status === "corrupt" || draft.status === "unsupported" ? "We couldn’t read the needs saved on this browser, so they were left untouched." : null}
        access={account && !account.authenticated && account.accessCodeRequired ? { required: true, onUnlock: async (code) => {
          try { const next = await unlockSession(code); setAccount(next); void listAccountBriefs().then((r) => setAccountBriefs(r.briefs.map((x) => x.brief))).catch(() => undefined); return null; }
          catch (failure) { return errorText(failure, "That access code wasn’t accepted."); }
        } } : null}
        notice={homeNotice}
        onFind={startNeeds}
        onResume={() => { if (resume) void openWorkspace(() => resume.source === "agent" ? loadAgentWorkspace(resume.runId) : loadDeterministicWorkspace(resume.runId), "Opening your search…", resume); }}
        onOpenPlan={openPlan}
        onResetProfile={() => { try { resetProfileDraft(localStorage); } catch { /* blocked storage */ } setDraft({ status: "empty" }); setEnvelope(null); setHomeNotice("Starting fresh with the example restaurant."); }}
      />;
      break;
    case "needs":
      body = form && <main className="sx-page"><NeedsWizard key={screen.step} form={form} onChange={setForm} step={screen.step} fromExample={Boolean(revision?.isDemo)}
        returnToReview={screen.returnToReview} onStep={(step) => setScreen({ name: "needs", step, returnToReview: false })}
        onReview={() => { setReview({ busy: false, error: "" }); setScreen({ name: "review" }); }} onExit={() => goHome()} /></main>;
      break;
    case "review":
      body = form && <NeedsReview form={form} revisions={envelope?.revisions ?? []} busy={review.busy} error={review.error}
        onChange={(step) => setScreen({ name: "needs", step, returnToReview: true })}
        onFind={findLocations}
        onSaveExit={() => { if (commitNeeds()) { setHomeNotice("Your needs are saved."); goHome(); } }}
        onBack={() => setScreen({ name: "needs", step: 4, returnToReview: false })} />;
      break;
    case "search":
      body = searchProfile && <SearchProgress key={screen.attempt} profile={searchProfile} cityId={CITY_ID}
        onBack={() => setScreen({ name: "review" })}
        onSeeLocations={(source, runId) => {
          try { clearSearchSession(localStorage); } catch { /* optional */ }
          void openWorkspace(() => (source === "agent" ? loadAgentWorkspace(runId) : loadDeterministicWorkspace(runId)), "Getting your places ready…");
        }} />;
      break;
    case "loading":
      body = screen.error ? (
        <main className="sx-page">
          <div className="sx-notice sx-notice-bad" role="alert"><div className="sx-stack"><p>{screen.error}</p>
            <div className="sx-row">{screen.retry && <button type="button" className="sx-btn sx-btn-primary" onClick={screen.retry}>Try again</button>}
              <button type="button" className="sx-btn sx-btn-secondary" onClick={() => goHome()}>Back home</button></div></div></div>
        </main>
      ) : <Loading>{screen.message}</Loading>;
      break;
    case "places":
      body = workspace && <Places workspace={workspace} views={views} saved={saved} selectedId={selectedId} notice={listNotice}
        onSelect={setSelectedId} onOpen={(id) => { ensureChoice(id); setPlaceState({ busy: false, notice: "", error: "" }); setScreen({ name: "place", id }); }}
        onToggleSave={toggleSave} onCompare={() => setScreen({ name: "compare" })} onNewSearch={startNeeds} />;
      break;
    case "place": {
      const choice = workspace ? choiceFor(screen.id) : null;
      body = workspace && choice && <PlaceDetail workspace={workspace} choice={choice} isSaved={saved.includes(screen.id)} savedCount={saved.length} maxSaved={MAX_SAVED_PLACES}
        image={imageFor(screen.id)} busy={placeState.busy} notice={placeState.notice} error={placeState.error}
        onBack={() => { setSelectedId(screen.id); setScreen(restoredFrom ? { name: "plan" } : { name: "places" }); }}
        onToggleSave={() => toggleSave(screen.id)} onCompare={() => setScreen({ name: "compare" })} onAsk={() => askAboutPlace(screen.id)}
        onRefresh={(mode) => void refreshSources(screen.id, mode)}
        onAddNote={(note) => { revise(screen.id, [...choice.assessment.notes, note], choice.assessment.sources); setPlaceState({ busy: false, error: "", notice: note.category === "verification" ? "Thanks. We re-checked this place with what you saw." : "Your assumption is noted. It won’t confirm a must-have." }); }} />;
      break;
    }
    case "compare":
      body = workspace && <Compare workspace={workspace} choices={compareChoices} images={new Map(compareChoices.map((c) => [c.candidateId, imageFor(c.candidateId)]))} pick={pick}
        onPick={(id) => { ensureChoice(id); setPick(id); }} onWorkOut={() => setScreen({ name: "costs", step: 0 })} onAsk={askCompare}
        onOpen={(id) => { ensureChoice(id); setPlaceState({ busy: false, notice: "", error: "" }); setScreen({ name: "place", id }); }} onBack={() => setScreen({ name: "places" })} />;
      break;
    case "costs": {
      const choice = pick ? choiceFor(pick) : null;
      body = workspace && choice && <CostWizard key={`${pick}-${screen.step}`} workspace={workspace} choice={choice} stepIndex={screen.step}
        onStep={(step) => setScreen({ name: "costs", step })} onApply={(inputs) => applyFinance(choice.candidateId, inputs)}
        onResults={() => setScreen({ name: "costResults" })} onBack={() => setScreen({ name: "compare" })} />;
      break;
    }
    case "costResults": {
      const choice = pick ? choiceFor(pick) : null;
      body = workspace && choice && <CostResults key={`${pick}-${JSON.stringify(choice.financeInputs)}`} workspace={workspace} choice={choice}
        onEdit={(key: CostKey) => setScreen({ name: "costs", step: Math.max(0, costSteps(choice).indexOf(key)) })}
        onApply={(inputs) => applyFinance(choice.candidateId, inputs)} onRecommend={() => { setPlanState({ saving: false, notice: "", error: "" }); setScreen({ name: "plan" }); }}
        onAsk={() => askCosts(choice.candidateId)} onBack={() => setScreen({ name: "costs", step: 0 })} onReset={() => resetFinance(choice.candidateId)} />;
      break;
    }
    case "plan": {
      const picked = planChoices[0];
      body = workspace && picked && <Plan workspace={workspace} choices={planChoices} pick={picked} image={imageFor(picked.candidateId)} plans={plans} restoredFrom={restoredFrom}
        saving={planState.saving} notice={planState.notice} error={planState.error} onSave={savePlan} onAsk={() => askPlan(picked)}
        onBack={() => (restoredFrom ? goHome() : setScreen({ name: "costResults" }))} onOpenPlan={(entry) => openPlan(entry.brief)}
        onStartOver={() => { setWorkspace(null); setRestoredFrom(null); goHome(); }} />;
      break;
    }
  }

  return (
    <div className="sx-root">
      <Header exampleName={exampleName} />
      {body ?? <Loading>Getting things ready…</Loading>}
      {ask && <AskDrawer ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
