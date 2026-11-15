"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Building2,
  Check,
  ClipboardList,
  FileText,
  FlaskConical,
  Pencil,
  RotateCcw,
  Save,
  Sprout,
  Store,
} from "lucide-react";
import {
  createProfileRevision,
  requirementDisplayValue,
  type ProfileRevision,
  type RequirementIssue,
} from "../../domain/requirements.ts";
import {
  PROFILE_DRAFT_SCHEMA_VERSION,
  type RestaurantIntake,
} from "../../domain/intake.ts";
import {
  currentProfileRevision,
  profileDraftEnvelopeSchema,
  type ProfileDraftEnvelope,
  type ProfileDraftStatus,
} from "../storage.ts";
import { exampleIntake } from "../data/intake-example.ts";
import {
  buildEdits,
  changedSummary,
  FORM_LABELS,
  formFromRevision,
  MARKET_OPTIONS,
  requirementToField,
  type FieldIssue,
  type FormState,
} from "../profile-form.ts";

type View = "start" | "review" | "edit";

export function ProfileWorkspace({
  draftStatus,
  sessionEnvelope = null,
  onSessionChange,
  onSave,
  onReset,
  onContinue,
}: {
  draftStatus: ProfileDraftStatus;
  /** In-memory working draft owned by the page, survives explorer visits. */
  sessionEnvelope?: ProfileDraftEnvelope | null;
  onSessionChange?: (envelope: ProfileDraftEnvelope | null) => void;
  onSave: (envelope: ProfileDraftEnvelope) => boolean;
  onReset: () => boolean;
  onContinue: (revision: ProfileRevision | null, saved: boolean) => void;
}) {
  const initialWorking: ProfileDraftEnvelope | null =
    sessionEnvelope ?? (draftStatus.status === "ok" ? draftStatus.envelope : null);
  const [working, setWorking] = useState<ProfileDraftEnvelope | null>(
    initialWorking,
  );
  const saved = draftStatus.status === "ok";
  const corruptPending =
    draftStatus.status === "corrupt" || draftStatus.status === "unsupported";
  const [view, setView] = useState<View>(initialWorking ? "review" : "start");
  const [form, setForm] = useState<FormState | null>(
    initialWorking
      ? formFromRevision(currentProfileRevision(initialWorking))
      : null,
  );
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [notice, setNotice] = useState("");
  const summaryRef = useRef<HTMLDivElement>(null);

  const latest = working ? currentProfileRevision(working) : null;
  const intake: RestaurantIntake | null = latest?.intakeSnapshot ?? null;

  function chooseExample() {
    const created = new Date().toISOString();
    const revision = createProfileRevision(
      exampleIntake(),
      {
        revisionId: crypto.randomUUID(),
        revisionNumber: 0,
        createdAt: created,
        parentRevisionId: null,
        editSummary: "Imported the example restaurant profile.",
      },
      [],
    );
    const envelope = profileDraftEnvelopeSchema.parse({
      schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION,
      updatedAt: created,
      revisions: [revision],
    });
    setWorking(envelope);
    setForm(formFromRevision(revision));
    setIssues([]);
    setNotice(
      "Cedar Kitchen's fictional example profile loaded. Review it, then save a draft or continue.",
    );
    setView("review");
    onSessionChange?.(envelope);
  }

  function startEditing() {
    if (!latest) return;
    setForm(formFromRevision(latest));
    setIssues([]);
    setNotice("");
    setView("edit");
  }

  function handleSave() {
    if (!working || !form) return;
    const current = currentProfileRevision(working);
    const { edits, issues: fieldIssues } = buildEdits(form, current);
    if (fieldIssues.length) {
      setIssues(fieldIssues);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    try {
      const intakeSnapshot = working.revisions[0].intakeSnapshot;
      const createdAt = new Date().toISOString();
      const followUps = {
        cashReserveToKeep:
          form.reserve.trim() === "" ? null : Number(form.reserve),
        ventilationRequirements:
          form.ventilation.trim() === "" ? null : form.ventilation.trim(),
        financialBaselineNote:
          form.baselineNote.trim() === "" ? null : form.baselineNote.trim(),
      };
      let nextEnvelope: ProfileDraftEnvelope;
      if (!saved) {
        if (edits.length === 0) {
          nextEnvelope = { ...working, updatedAt: createdAt };
        } else {
          const edited = createProfileRevision(
            intakeSnapshot,
            {
              revisionId: crypto.randomUUID(),
              revisionNumber: 1,
              createdAt,
              parentRevisionId: current.revisionId,
              editSummary: changedSummary(edits, current),
            },
            edits,
            followUps,
          );
          nextEnvelope = profileDraftEnvelopeSchema.parse({
            schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION,
            updatedAt: createdAt,
            revisions: [working.revisions[0], edited],
          });
        }
      } else {
        if (edits.length === 0) {
          setNotice("No changes since the saved revision.");
          return;
        }
        const edited = createProfileRevision(
          intakeSnapshot,
          {
            revisionId: crypto.randomUUID(),
            revisionNumber: current.revisionNumber + 1,
            createdAt,
            parentRevisionId: current.revisionId,
            editSummary: changedSummary(edits, current),
          },
          edits,
          followUps,
        );
        nextEnvelope = profileDraftEnvelopeSchema.parse({
          schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION,
          updatedAt: createdAt,
          revisions: [...working.revisions, edited],
        });
      }
      const persisted = onSave(nextEnvelope);
      setIssues([]);
      if (persisted) {
        setWorking(nextEnvelope);
        onSessionChange?.(nextEnvelope);
        setNotice("");
        setView("review");
      } else {
        // Keep the pre-save revision chain intact: the unsaved revision must
        // not become a parent for the next attempt. The form keeps the edits.
        setNotice(
          "Saving failed; browser storage may be unavailable or full. Your edits remain in memory.",
        );
      }
    } catch (error) {
      const issuesFromError: FieldIssue[] = [];
      if (error instanceof Error && error.name === "ProfileValidationError") {
        for (const issue of (
          error as unknown as { issues: RequirementIssue[] }
        ).issues) {
          issuesFromError.push({
            field: requirementToField(issue.requirementId),
            message: issue.message,
          });
        }
      } else {
        issuesFromError.push({
          field: "occupancy",
          message:
            error instanceof Error
              ? error.message
              : "The requirements could not be validated.",
        });
      }
      setIssues(issuesFromError);
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  function handleReset() {
    if (!onReset()) {
      setNotice(
        "Browser storage is still unavailable. You can keep reviewing without saving.",
      );
      return;
    }
    setWorking(null);
    setForm(null);
    setIssues([]);
    setNotice(
      "Stored profile content was reset. No business records were changed.",
    );
    setView("start");
    onSessionChange?.(null);
  }

  const fieldIssues = new Map(issues.map((issue) => [issue.field, issue]));

  return (
    <main className="profile-main">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h1>Know the requirements before you scout.</h1>
          <p>
            Review the restaurant profile that will drive every expansion
            search. Requirements stay editable; the interview stays intact.
          </p>
        </div>
        <span className="demo-pill">
          <FlaskConical size={13} /> Fictional example profile
        </span>
      </div>

      {corruptPending && (
        <div role="alert" className="profile-storage-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>
              Stored profile content could not be read and has been preserved
              untouched.
            </strong>
            <p>
              {draftStatus.status === "unsupported"
                ? `Unsupported draft version ${String(draftStatus.schemaVersion)}.`
                : "The stored content is corrupt."}{" "}
              Choose “Use example restaurant” to review a fresh profile, or
              reset the stored content explicitly. Saving stays disabled until
              you reset.
            </p>
          </div>
          <button className="secondary" onClick={handleReset}>
            <RotateCcw size={14} /> Reset stored profile
          </button>
        </div>
      )}

      {view === "start" && (
        <section className="profile-start" aria-label="Profile setup">
          <div className="profile-start-card">
            <span className="round-icon">
              <Store size={24} />
            </span>
            <div>
              <h2>Set up the restaurant profile</h2>
              <p>
                Start with Cedar Kitchen, a fictional Mediterranean
                dine-in/takeout restaurant in Houston, built from a simulated
                owner interview. Its seven answers, source references and
                unknown values are preserved exactly.
              </p>
            </div>
            <div className="profile-start-actions">
              <button className="primary" onClick={chooseExample}>
                <FlaskConical size={15} /> Use example restaurant
              </button>
              <button
                className="secondary"
                onClick={() => onContinue(latest, saved)}
              >
                Continue to the scouting map <ArrowRight size={15} />
              </button>
              <p className="small-note">
                The scouting map also works without a profile. Intake-based
                matching arrives in the next phase; nothing is presented as a
                filtered result yet.
              </p>
            </div>
          </div>
        </section>
      )}

      {view !== "start" && working && latest && intake && form && (
        <>
          <div className="profile-saved-state">
            <span className="tiny-badge">
              {saved ? `Saved revision ${latest.revisionNumber}` : "Unsaved draft"}
            </span>
            <span>
              Revision {latest.revisionNumber} ·{" "}
              {new Date(latest.createdAt).toLocaleString()}
            </span>
            <span className="tiny-badge">
              {latest.isDemo ? "Fictional" : "Live"}
            </span>
          </div>

          <section className="profile-block" aria-label="Restaurant basics">
            <div className="section-caption">
              <Building2 size={15} />
              <h2>Restaurant</h2>
            </div>
            <dl className="profile-facts">
              <div>
                <dt>Name</dt>
                <dd>{intake.restaurant.name}</dd>
              </div>
              <div>
                <dt>Cuisine</dt>
                <dd>{intake.restaurant.cuisine}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{intake.restaurant.serviceType.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Current location</dt>
                <dd>
                  {intake.restaurant.currentCity},{" "}
                  {intake.restaurant.currentState}
                </dd>
              </div>
              <div>
                <dt>Goal</dt>
                <dd>{intake.expansion.goal.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Target market</dt>
                <dd>
                  {intake.expansion.targetCity}, {intake.expansion.targetState}{" "}
                  ({intake.expansion.targetCountry})
                </dd>
              </div>
            </dl>
            <p className="small-note">{intake.description}</p>
          </section>

          <section
            className="profile-block"
            aria-label="Original interview answers"
          >
            <div className="section-caption">
              <FileText size={15} />
              <h2>Original interview answers</h2>
              <span className="tiny-badge">
                {intake.sourceAnswers.length} answers · never rewritten
              </span>
            </div>
            <div className="answer-list">
              {intake.sourceAnswers.map((answer) => (
                <article key={answer.id} className="answer-card">
                  <p className="answer-question">{answer.question}</p>
                  <blockquote>{answer.answer}</blockquote>
                  <code>{answer.id}</code>
                </article>
              ))}
            </div>
          </section>

          <section className="profile-block" aria-label="Requirements">
            <div className="section-caption">
              <ClipboardList size={15} />
              <h2>Requirements</h2>
              <span className="tiny-badge">
                model {latest.requirements.modelVersion}
              </span>
            </div>
            <table className="requirement-table">
              <caption>
                Normalized from the interview. Hard requirements can block a
                candidate; soft requirements are preferences. Unknown values
                stay unknown.
              </caption>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Source answers</th>
                </tr>
              </thead>
              <tbody>
                {latest.requirements.requirements.map((requirementItem) => (
                  <tr key={requirementItem.id}>
                    <th scope="row">
                      {requirementItem.label}
                      {requirementItem.origin === "assumed" && (
                        <span className="tiny-badge edited">edited</span>
                      )}
                    </th>
                    <td>
                      {requirementDisplayValue(requirementItem)}
                      {requirementItem.unit ? ` ${requirementItem.unit}` : ""}
                    </td>
                    <td>
                      <span className={`tiny-badge ${requirementItem.kind}`}>
                        {requirementItem.kind}
                      </span>
                    </td>
                    <td>
                      {requirementItem.originalSourceAnswerIds.length
                        ? requirementItem.originalSourceAnswerIds.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="matching-notes">
              {intake.matchingNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          {view === "edit" && (
            <section
              className="profile-block profile-edit"
              aria-label="Edit requirements"
            >
              <div className="section-caption">
                <Pencil size={15} />
                <h2>Edit requirements</h2>
                <span className="tiny-badge">
                  your changes create a new revision; the interview is
                  preserved
                </span>
              </div>
              {issues.length > 0 && (
                <div
                  role="alert"
                  tabIndex={-1}
                  ref={summaryRef}
                  className="profile-error-summary"
                >
                  <strong>Some values need attention before saving.</strong>
                  <ul>
                    {issues.map((issue) => (
                      <li key={`${issue.field}-${issue.message}`}>
                        {FORM_LABELS[issue.field]}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="profile-form-grid">
                <label className="field">
                  Total monthly occupancy limit (hard)
                  <input
                    type="number"
                    min={0}
                    value={form.occupancy}
                    aria-invalid={fieldIssues.has("occupancy")}
                    aria-describedby={
                      fieldIssues.has("occupancy") ? "occupancy-error" : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, occupancy: event.target.value })
                    }
                  />
                  <small>
                    USD / month · includes base rent and additional charges
                  </small>
                  {fieldIssues.has("occupancy") && (
                    <span id="occupancy-error" className="field-error" role="alert">
                      {fieldIssues.get("occupancy")!.message}
                    </span>
                  )}
                </label>
                <label className="field">
                  Total available funds (hard)
                  <input
                    type="number"
                    min={0}
                    value={form.funds}
                    aria-invalid={fieldIssues.has("funds")}
                    aria-describedby={
                      fieldIssues.has("funds") ? "funds-error" : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, funds: event.target.value })
                    }
                  />
                  <small>USD · not the same as opening spend</small>
                  {fieldIssues.has("funds") && (
                    <span id="funds-error" className="field-error" role="alert">
                      {fieldIssues.get("funds")!.message}
                    </span>
                  )}
                </label>
                <label className="field">
                  Emergency reserve (optional follow-up)
                  <input
                    type="number"
                    min={0}
                    value={form.reserve}
                    aria-invalid={fieldIssues.has("reserve")}
                    aria-describedby={
                      fieldIssues.has("reserve") ? "reserve-error" : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, reserve: event.target.value })
                    }
                  />
                  <small>
                    USD · leave blank to keep it unknown — it is not zero
                  </small>
                  {fieldIssues.has("reserve") && (
                    <span id="reserve-error" className="field-error" role="alert">
                      {fieldIssues.get("reserve")!.message}
                    </span>
                  )}
                </label>
                <label className="field">
                  Preferred seats — minimum (preference)
                  <input
                    type="number"
                    min={0}
                    value={form.seatsMin}
                    aria-invalid={fieldIssues.has("seatsMin")}
                    aria-describedby={
                      fieldIssues.has("seatsMin") ? "seats-min-error" : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, seatsMin: event.target.value })
                    }
                  />
                  <small>seats · a preference, never a square-footage filter</small>
                  {fieldIssues.has("seatsMin") && (
                    <span id="seats-min-error" className="field-error" role="alert">
                      {fieldIssues.get("seatsMin")!.message}
                    </span>
                  )}
                </label>
                <label className="field">
                  Preferred seats — maximum (preference)
                  <input
                    type="number"
                    min={0}
                    value={form.seatsMax}
                    onChange={(event) =>
                      setForm({ ...form, seatsMax: event.target.value })
                    }
                  />
                  <small>seats · must be at least the minimum</small>
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.kitchen}
                    onChange={(event) =>
                      setForm({ ...form, kitchen: event.target.checked })
                    }
                  />
                  Existing kitchen is mandatory
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.parking}
                    onChange={(event) =>
                      setForm({ ...form, parking: event.target.checked })
                    }
                  />
                  Customer parking is mandatory
                </label>
                <label className="field">
                  Target market
                  <select
                    value={form.market}
                    aria-invalid={fieldIssues.has("market")}
                    aria-describedby={
                      fieldIssues.has("market") ? "market-error" : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, market: event.target.value })
                    }
                  >
                    {MARKET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>unsupported markets are rejected, not re-interpreted</small>
                  {fieldIssues.has("market") && (
                    <span id="market-error" className="field-error" role="alert">
                      {fieldIssues.get("market")!.message}
                    </span>
                  )}
                </label>
                <label className="field">
                  Preferred neighborhoods
                  <input
                    type="text"
                    value={form.neighborhoods}
                    aria-invalid={fieldIssues.has("neighborhoods")}
                    aria-describedby={
                      fieldIssues.has("neighborhoods")
                        ? "neighborhoods-error"
                        : undefined
                    }
                    onChange={(event) =>
                      setForm({ ...form, neighborhoods: event.target.value })
                    }
                  />
                  <small>comma-separated · Heights preferred, others acceptable</small>
                  {fieldIssues.has("neighborhoods") && (
                    <span
                      id="neighborhoods-error"
                      className="field-error"
                      role="alert"
                    >
                      {fieldIssues.get("neighborhoods")!.message}
                    </span>
                  )}
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.othersAcceptable}
                    onChange={(event) =>
                      setForm({ ...form, othersAcceptable: event.target.checked })
                    }
                  />
                  Other Houston neighborhoods are acceptable
                </label>
                <label className="field wide">
                  Cooking / ventilation needs (optional follow-up)
                  <input
                    type="text"
                    value={form.ventilation}
                    onChange={(event) =>
                      setForm({ ...form, ventilation: event.target.value })
                    }
                  />
                  <small>
                    e.g. gas range and hood · not required to start scouting
                  </small>
                </label>
                <label className="field wide">
                  Financial baseline note (optional follow-up)
                  <input
                    type="text"
                    value={form.baselineNote}
                    onChange={(event) =>
                      setForm({ ...form, baselineNote: event.target.value })
                    }
                  />
                  <small>
                    profit and payback stay unavailable without a real baseline
                  </small>
                </label>
              </div>
              <div className="profile-actions">
                <button
                  className="primary"
                  onClick={handleSave}
                  disabled={!saved && corruptPending}
                >
                  <Save size={15} /> Save profile draft
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setIssues([]);
                    setView("review");
                  }}
                >
                  <RotateCcw size={15} /> Cancel edits
                </button>
                <button className="text-button" onClick={handleReset}>
                  Start over
                </button>
                {notice && (
                  <p role="status" className="profile-inline-notice">
                    {notice}
                  </p>
                )}
              </div>
              {corruptPending && (
                <p className="small-note">
                  Saving stays disabled while unreadable stored content is
                  preserved. Reset it first.
                </p>
              )}
            </section>
          )}

          <section className="profile-block" aria-label="Revision history">
            <div className="section-caption">
              <Bookmark size={15} />
              <h2>Profile revisions</h2>
              <span className="tiny-badge">
                {working.revisions.length} immutable revision
                {working.revisions.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="revision-list">
              {[...working.revisions]
                .sort((a, b) => b.revisionNumber - a.revisionNumber)
                .map((revision) => (
                  <article key={revision.revisionId}>
                    <strong>Revision {revision.revisionNumber}</strong>
                    <span>{new Date(revision.createdAt).toLocaleString()}</span>
                    <p>{revision.editSummary}</p>
                    <code>{revision.revisionId}</code>
                  </article>
                ))}
            </div>
            <p className="small-note">
              Every saved change creates a new immutable revision. Previous
              revisions and the original interview answers stay reproducible.
              Drafts live in this browser only — not a backed-up account.
            </p>
          </section>

          <div className="profile-actions">
            <button
              className="primary"
              onClick={() => onContinue(latest, saved)}
            >
              Continue to the scouting map <ArrowRight size={15} />
            </button>
            {view === "review" && (
              <button className="secondary" onClick={startEditing}>
                <Pencil size={15} /> Edit requirements
              </button>
            )}
            {view === "review" && (
              <button className="text-button" onClick={handleReset}>
                <RotateCcw size={14} /> Start over
              </button>
            )}
          </div>
          {notice && (
            <p role="status" className="profile-inline-notice">
              {notice}
            </p>
          )}
          <p className="profile-footnote">
            <Check size={14} /> The profile is explicitly fictional. Saving it
            does not contact brokers, lease a space, or change business
            records.
          </p>
        </>
      )}
      {view === "start" && (
        <p className="profile-footnote">
          <Sprout size={14} /> No real restaurant, financial records, or
          property sources are used in the example.
        </p>
      )}
    </main>
  );
}
