"use client";

import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { fixtureProvider } from "./data/demo-market.ts";
import { loadMarkets, LocalDataError } from "./data/local-market.ts";
import type { ExpansionProvider } from "../domain/provider.ts";
import type { Dataset, Scenario } from "../domain/schemas.ts";
import type { ProfileRevision } from "../domain/requirements.ts";
import {
  decodeScenarios,
  decodeProfileDraft,
  MODE_STORAGE_KEY,
  persistProfileDraft,
  PROFILE_DRAFT_STORAGE_KEY,
  resetProfileDraft,
  storageKeyFor,
  type ProfileDraftEnvelope,
  type ProfileDraftStatus,
} from "./storage.ts";
import { ExpansionHeader } from "./components/expansion-header";
import { ExpansionWorkspace } from "./components/expansion-workspace";
import { ProfileWorkspace } from "./components/profile-workspace";
import { AccountError, ensureSession, loadAccountProfile, saveAccountProfile, unlockSession, type SessionStatus } from "./data/account-client.ts";
import { profileDraftEnvelopeSchema } from "./storage.ts";
import "./components/expansion.css";

export default function ExpansionPage({ provider = fixtureProvider }: { provider?: ExpansionProvider }) {
  const [mode, setMode] = useState<"demo" | "local">("demo");
  const [initialized, setInitialized] = useState(false);
  const [view, setView] = useState<"profile" | "explorer">("profile");
  const [loaded, setLoaded] = useState<{ mode: "demo" | "local"; dataset: Dataset; saved: Scenario[]; storageError: string | null } | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [profileDraft, setProfileDraft] = useState<ProfileDraftStatus>({ status: "empty" });
  const [sessionEnvelope, setSessionEnvelope] = useState<ProfileDraftEnvelope | null>(null);
  const [activeProfile, setActiveProfile] = useState<{ revision: ProfileRevision; saved: boolean } | null>(null);
  const [profileNotice, setProfileNotice] = useState("");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    void Promise.resolve().then(async () => {
      let local: ProfileDraftStatus = { status: "empty" };
      try {
        if (localStorage.getItem(MODE_STORAGE_KEY) === "local") setMode("local");
        local = decodeProfileDraft(localStorage.getItem(PROFILE_DRAFT_STORAGE_KEY));
        setProfileDraft(local);
      } catch { /* Storage is optional. */ }
      const status = await ensureSession().catch(() => null);
      setSession(status);
      // Restore from the private workspace only when this browser has no draft;
      // a local draft (or preserved corrupt content) is never overwritten.
      if (status?.authenticated && local.status === "empty") {
        const remote = await loadAccountProfile().catch(() => null);
        const parsed = remote?.envelope ? profileDraftEnvelopeSchema.safeParse(remote.envelope) : null;
        if (parsed?.success) {
          setProfileDraft({ status: "ok", envelope: parsed.data });
          setProfileNotice(`Profile restored from your private workspace (${remote?.storage}).`);
        }
      }
      setInitialized(true);
    });
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    try { setSession(await unlockSession(accessCode)); setAccessError(""); setAccessCode(""); }
    catch (failure) { setAccessError(failure instanceof Error ? failure.message : "The access code was not accepted."); }
  }

  function changeMode(next: "demo" | "local") {
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* Mode remains usable without storage. */ }
    setError(null);
    setMode(next);
  }

  useEffect(() => {
    if (!initialized || view !== "explorer") return;
    const controller = new AbortController();
    const load = mode === "demo" ? provider.load(controller.signal) : loadMarkets(controller.signal).then((result) => ({
      cities: result.cities, areas: [], properties: [], evidence: result.evidence, metadata: result.metadata,
    }));
    load.then((dataset) => {
      if (controller.signal.aborted) return;
      let saved: Scenario[] = [];
      let storageError: string | null = null;
      try {
        saved = decodeScenarios(localStorage.getItem(storageKeyFor(mode)));
        if (saved.some((snapshot) => snapshot.isDemo !== (mode === "demo"))) throw new Error("Wrong data mode");
      } catch {
        saved = [];
        storageError = `Saved ${mode === "demo" ? "demo" : "local dataset"} scenarios could not be read. Existing storage has been preserved. Clear saved ${mode === "demo" ? "demo" : "local"} data to start again.`;
      }
      setError(null);
      setLoaded({ mode, dataset, saved, storageError });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError({ message: failure instanceof Error ? failure.message : "The scouting data could not load.", code: failure instanceof LocalDataError ? failure.code : undefined });
    });
    return () => controller.abort();
  }, [provider, attempt, mode, initialized, view]);

  function handleProfileSave(envelope: ProfileDraftEnvelope): boolean {
    try {
      persistProfileDraft(localStorage, envelope);
      setProfileDraft({ status: "ok", envelope });
      setSessionEnvelope(envelope);
      setActiveProfile({
        revision: [...envelope.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0],
        saved: true,
      });
      const revisionNumber = [...envelope.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0].revisionNumber;
      setProfileNotice(`Profile draft saved on this browser (revision ${revisionNumber}). Saving to your private workspace… No business records changed.`);
      void saveAccountProfile(envelope)
        .then((report) => setProfileNotice(`Profile revision ${revisionNumber} saved on this browser and in your private workspace (${report.storage}). No business records changed.`))
        .catch((failure) => setProfileNotice(`Profile revision ${revisionNumber} saved on this browser only. Workspace save failed: ${failure instanceof AccountError || failure instanceof Error ? failure.message : "storage unavailable"}`));
      return true;
    } catch {
      setProfileNotice("Saving failed. Browser storage may be unavailable or full; your draft is intact.");
      return false;
    }
  }

  function handleProfileReset(): boolean {
    try {
      resetProfileDraft(localStorage);
      setProfileDraft({ status: "empty" });
      setSessionEnvelope(null);
      setActiveProfile(null);
      setProfileNotice("Stored profile draft reset. Nothing else in browser storage was touched.");
      return true;
    } catch {
      setProfileNotice("Browser storage is unavailable. Stored profile content could not be reset.");
      return false;
    }
  }

  function continueToExplorer(revision: ProfileRevision | null, saved: boolean) {
    setActiveProfile(revision ? { revision, saved } : null);
    setProfileNotice("");
    setView("explorer");
  }

  if (!initialized)
    return <div className="expansion-app">
      <ExpansionHeader mode={mode} onModeChange={changeMode} />
      <main className="startup" role="status">
        <Compass size={32} />
        <h1>Preparing your scouting map…</h1>
      </main>
    </div>;

  if (view === "profile")
    return (
      <div className="expansion-app">
        <ExpansionHeader mode={mode} onModeChange={changeMode} />
        {session && !session.authenticated && session.accessCodeRequired && (
          <form className="notice-toast" style={{ position: "static", margin: "12px auto", maxWidth: 640 }} onSubmit={unlock} aria-label="Unlock private workspace">
            <label>Workspace access code <input type="password" autoComplete="current-password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} required maxLength={256} /></label>
            <button className="primary">Unlock private workspace</button>
            {accessError && <p role="alert" className="warning">{accessError}</p>}
            <p className="small-note">Runs, profiles and briefs are private to your workspace. Without unlocking, saving stays on this browser only.</p>
          </form>
        )}
        <ProfileWorkspace
          key={
            profileDraft.status === "ok"
              ? `profile-${[...profileDraft.envelope.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0].revisionId}`
              : `profile-${profileDraft.status}`
          }
          draftStatus={profileDraft}
          sessionEnvelope={sessionEnvelope}
          onSessionChange={setSessionEnvelope}
          onSave={handleProfileSave}
          onReset={handleProfileReset}
          onContinue={continueToExplorer}
        />
        <div
          role="status"
          aria-live="polite"
          className={profileNotice ? "notice-toast" : "sr-only"}
        >
          {profileNotice}
        </div>
      </div>
    );

  if (!loaded || loaded.mode !== mode)
    return <div className="expansion-app">
      <ExpansionHeader mode={mode} onModeChange={changeMode} />
      <main className="startup" role={error ? "alert" : "status"}>
        <Compass size={32} />
        <h1>{error ? error.code === "not_configured" ? "Local dataset is not configured." : "The scouting data could not load." : "Preparing your scouting map…"}</h1>
        <p>{error ? error.message : mode === "demo" ? "Loading explicitly fictional demo fixtures." : "Reading supported markets from the local dataset snapshot."}</p>
        {error && <button className="primary" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry data</button>}
        {mode === "local" && <p className="small-note">Local snapshots are dated records. They do not verify current availability.</p>}
      </main>
    </div>;
  if (!loaded.dataset.cities.length) return <div className="expansion-app">
    <ExpansionHeader mode={mode} onModeChange={changeMode} />
    <main className="startup"><Compass size={32} /><h1>No supported markets in this snapshot.</h1><p>No records with usable market geography were returned.</p><button className="primary" onClick={() => setAttempt((value) => value + 1)}>Retry data</button></main>
  </div>;
  return <ExpansionWorkspace key={mode} dataset={loaded.dataset} initialSaved={loaded.saved}
    initialStorageError={loaded.storageError} mode={mode} onModeChange={changeMode}
    profile={activeProfile}
    onEditProfile={() => setView("profile")} />;
}
