"use client";

import { Sprout } from "lucide-react";
import { useState } from "react";
import type { DecisionBrief } from "../../domain/decision-brief.ts";
import type { ProfileSummary } from "../data/account-client.ts";
import { Disclosure, Tag } from "./ui.tsx";

export type PlanEntry = { brief: DecisionBrief; where: "workspace" | "browser" };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function Home({ resume, plans, profiles, profilesError, profileProblem, access, notice, onFind, onUseProfile, onNewProfile, onTryExample, onRetryProfiles, onResume, onOpenPlan, onResetProfile }: {
  resume: { cityLabel: string; placesFound: number; saved: number } | null;
  plans: PlanEntry[];
  /** null while the workspace list is loading. */
  profiles: ProfileSummary[] | null;
  profilesError: string;
  profileProblem: string | null;
  access: { required: boolean; onUnlock: (code: string) => Promise<string | null> } | null;
  notice: string;
  onFind: () => void;
  onUseProfile: (profileId: string) => void;
  onNewProfile: () => void;
  onTryExample: () => void;
  onRetryProfiles: () => void;
  onResume: () => void;
  onOpenPlan: (brief: DecisionBrief) => void;
  onResetProfile: () => void;
}) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  return (
    <main className="sx-page">
      <div className="sx-stack-lg">
        <span className="sx-hero-icon" aria-hidden="true"><Sprout size={26} /></span>
        <div className="sx-stack">
          <h1 className="sx-title">Thinking about opening another location?</h1>
          <p className="sx-lead">Let’s find a place that fits your restaurant.</p>
        </div>
        <div className="sx-stack">
          <div><button type="button" className="sx-btn sx-btn-primary sx-btn-big" onClick={onFind}>Find Locations</button></div>
          {profiles?.[0] && <p className="sx-small sx-muted">For {profiles[0].restaurantName ?? "your restaurant"}. Pick another restaurant below.</p>}
        </div>
      </div>

      {notice && <p className="sx-notice sx-notice-good" role="status">{notice}</p>}

      <section className="sx-stack" aria-labelledby="sx-profiles-title">
        <h2 id="sx-profiles-title" className="sx-strong">Your restaurants</h2>
        {profiles === null && !profilesError && <p className="sx-small sx-muted" role="status">Loading your restaurant profiles…</p>}
        {profiles?.length === 0 && <p className="sx-small sx-muted">No restaurant profiles yet. Set one up and we’ll save it to your workspace.</p>}
        {profiles && profiles.length > 0 && (
          <ul className="sx-list">
            {profiles.map((profile) => {
              const name = profile.restaurantName ?? "Unnamed restaurant";
              const versions = profile.latestRevisionNumber + 1;
              return (
                <li key={profile.profileId}>
                  <span className="sx-list-main">
                    <span className="sx-list-value">{name} {profile.isDemo && <Tag kind="example">Example</Tag>}</span>
                    <span className="sx-list-label">Updated {dateLabel(profile.updatedAt)} · {versions} {versions === 1 ? "version" : "versions"} of your needs</span>
                  </span>
                  <button type="button" className="sx-btn sx-btn-secondary" onClick={() => onUseProfile(profile.profileId)} aria-label={`Use ${name}`}>Use</button>
                </li>
              );
            })}
          </ul>
        )}
        {profilesError && (
          <div className="sx-notice sx-notice-bad" role="alert">
            <div className="sx-stack"><p>{profilesError}</p><div><button type="button" className="sx-btn sx-btn-secondary" onClick={onRetryProfiles}>Try again</button></div></div>
          </div>
        )}
        <div className="sx-row">
          <button type="button" className="sx-btn sx-btn-secondary" onClick={onNewProfile}>New restaurant profile</button>
          {profiles !== null && !profiles.some((profile) => profile.isDemo) && <button type="button" className="sx-btn sx-btn-text" onClick={onTryExample}>Try the example restaurant</button>}
        </div>
      </section>

      {profileProblem && (
        <div className="sx-notice" role="alert">
          <div className="sx-stack">
            <p>{profileProblem}</p>
            <div><button type="button" className="sx-btn sx-btn-secondary" onClick={onResetProfile}>Discard the browser copy</button></div>
          </div>
        </div>
      )}

      {access?.required && (
        <form className="sx-form" aria-label="Unlock private workspace" onSubmit={async (event) => {
          event.preventDefault();
          const failure = await access.onUnlock(code);
          setCodeError(failure ?? "");
          if (!failure) setCode("");
        }}>
          <div className="sx-field">
            <label htmlFor="sx-access">Workspace access code</label>
            <input id="sx-access" className="sx-textinput" type="password" autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={256} />
          </div>
          {codeError && <p className="sx-error" role="alert">{codeError}</p>}
          <p className="sx-small sx-muted">Your restaurant profiles, searches and plans are private to your workspace. Unlock it to create or use a profile.</p>
          <div><button className="sx-btn sx-btn-primary">Unlock</button></div>
        </form>
      )}

      {resume && (
        <button type="button" className="sx-resume" onClick={onResume}>
          <span className="sx-resume-main">
            <span className="sx-resume-title">Continue your {resume.cityLabel} search.</span>
            <span className="sx-muted sx-small">{resume.placesFound} {resume.placesFound === 1 ? "place" : "places"} found · {resume.saved} saved</span>
          </span>
          <span className="sx-chevron" aria-hidden="true">›</span>
        </button>
      )}

      <Disclosure title="Saved plans" hint={plans.length} last>
        {plans.length === 0 ? <p className="sx-muted sx-small">No saved plans yet. After you compare places and work out costs, you can keep a plan here.</p> : (
          <ul className="sx-list">
            {plans.map(({ brief, where }) => (
              <li key={`${where}-${brief.id}`}>
                <span className="sx-list-main">
                  <span className="sx-list-value">{brief.title}</span>
                  <span className="sx-list-label">
                    {dateLabel(brief.createdAt)} · {brief.choices.length} places compared · {where === "workspace" ? "Saved to your workspace" : "Saved on this browser"}
                    {brief.runSnapshot.run.datasetDate ? ` · property data as of ${dateLabel(brief.runSnapshot.run.datasetDate)}` : " · uses a saved property snapshot"}
                  </span>
                </span>
                <button type="button" className="sx-btn sx-btn-secondary" onClick={() => onOpenPlan(brief)} aria-label={`Open plan ${brief.title}`}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </main>
  );
}
