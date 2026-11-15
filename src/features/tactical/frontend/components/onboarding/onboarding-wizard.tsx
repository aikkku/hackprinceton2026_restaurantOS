"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCheck, FileText, ImageIcon, MapPin, Plus, Sprout, TableProperties, Trash2, Upload, UtensilsCrossed } from "lucide-react";
import { onboardingSummarySchema, type OnboardingDraft, type OnboardingSummary } from "../../../domain/onboarding";
import { createOnboardingStore } from "../../onboarding-store";
import { OnboardingHeader, RestaurantIllustration } from "./brand";
import "./onboarding.css";

const uploadGroups = [
  { id: "menu", title: "Your menu", detail: "Dishes, prices, and a taste of what you do.", icon: UtensilsCrossed },
  { id: "space", title: "Your space", detail: "Dining room photos or a floor plan.", icon: ImageIcon },
  { id: "sales", title: "Your sales", detail: "Sales reports, spreadsheets, or exports.", icon: TableProperties },
  { id: "more", title: "Anything else", detail: "Reviews, schedules, inventory, and more.", icon: Plus },
] as const;
type UploadGroup = typeof uploadGroups[number]["id"];
type SelectedFile = { id: number; name: string };
type Files = Record<UploadGroup, SelectedFile[]>;
const emptyFiles = (): Files => ({ menu: [], space: [], sales: [], more: [] });
const goals = [
  { value: "improve", title: "Make my restaurant better", detail: "Find opportunities in the day-to-day.", icon: Sprout },
  { value: "expand", title: "Explore another location", detail: "See where your business could grow.", icon: MapPin },
  { value: "both", title: "A little of both", detail: "Strengthen today. Plan for tomorrow.", icon: CheckCheck },
] as const;

export function OnboardingWizard() {
  const [store] = useState(createOnboardingStore);
  const { draft, hydrated, storageAvailable } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [files, setFiles] = useState<Files>(emptyFiles);
  const [restaurant, setRestaurant] = useState<OnboardingSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const sequence = useRef(0);
  const initialFocus = useRef(true);
  const step = restaurant ? "ready" : draft.step;
  const selectedCount = Object.values(files).reduce((sum, group) => sum + group.length, 0);

  useEffect(() => {
    if (initialFocus.current) { initialFocus.current = false; return; }
    heading.current?.focus();
  }, [step]);

  function update(patch: Partial<OnboardingDraft>) { store.update(patch); setError(""); }
  function selectFiles(group: UploadGroup, selected: FileList | File[]) {
    const names = Array.from(selected).map(file => ({ id: ++sequence.current, name: file.name }));
    const remaining = Math.max(0, 20 - selectedCount);
    setFiles(current => ({ ...current, [group]: [...current[group], ...names.slice(0, remaining)] }));
    setError(names.length > remaining ? "You can select up to 20 files for this preview. Demo works with no files, too." : "");
  }
  async function openDemo() {
    if (!draft.demo || pending) return;
    setPending(true); setError("");
    try {
      // Intentionally never send entered details, filenames, or file contents.
      const response = await fetch("/api/tactical/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json();
      setRestaurant(onboardingSummarySchema.parse(result.restaurant));
      setFiles(emptyFiles());
    } catch { setError("The demo restaurant is unavailable right now. Your selections are still here. Please try again."); }
    finally { setPending(false); }
  }

  return <div className="sprout-theme sprout-onboarding">
    <a className="ob-skip" href="#onboarding-main">Skip to content</a>
    <OnboardingHeader />
    <main id="onboarding-main" className="ob-flow">
      <aside className="ob-flow-aside" aria-label="Setup progress">
        <span className="ob-eyebrow">A fresh start</span>
        <h2>Big possibilities.<br /><em>Small first steps.</em></h2>
        <p>A little context helps bring your restaurant into focus.</p>
        <ol className="ob-steps">
          {([['restaurant', 'Your restaurant', 'Start with the basics'], ['uploads', 'Bring it together', 'Share what you have'], ['ready', 'Ready to explore', 'Meet your workspace']] as const).map(([id, title, detail], i) => {
            const complete = (step === "uploads" && i === 0) || (step === "ready" && i < 2);
            return <li key={id} aria-current={step === id ? "step" : undefined} className={complete ? "ob-step-complete" : ""}><span>{complete ? <Check size={16} /> : `0${i + 1}`}</span><div><strong>{title}</strong><small>{detail}</small></div></li>;
          })}
        </ol>
        <div className="ob-aside-art"><RestaurantIllustration /></div>
      </aside>
      <section className="ob-flow-card" aria-labelledby="onboarding-title" aria-busy={pending}>
        <span className="ob-step-label">{step === "restaurant" ? "01 / YOUR RESTAURANT" : step === "uploads" ? "02 / RESTAURANT INFORMATION" : "03 / READY TO EXPLORE"}</span>
        {step === "restaurant" && <form onSubmit={event => { event.preventDefault(); update({ step: "uploads" }); }}>
          <h1 ref={heading} tabIndex={-1} id="onboarding-title">Let’s start with you.</h1>
          <p className="ob-lead">Every restaurant has a story. Where does yours begin?</p>
          <div className="ob-fields">
            <label>Restaurant name <span>Optional for demo</span><input value={draft.name} maxLength={120} autoComplete="organization" placeholder="What do people call your place?" onChange={event => update({ name: event.target.value })} /></label>
            <label>Location <span>Optional for demo</span><input value={draft.location} maxLength={240} autoComplete="street-address" placeholder="Neighborhood, city, or address" onChange={event => update({ location: event.target.value })} /></label>
          </div>
          <fieldset className="ob-goals"><legend>What’s on your mind?</legend>{goals.map(({ value, title, detail, icon: Icon }) => <label className={`ob-goal ${draft.goal === value ? "ob-selected" : ""}`} key={value}>
            <Icon size={20} /><span><strong>{title}</strong><small>{detail}</small></span><input type="radio" name="goal" value={value} checked={draft.goal === value} onChange={() => update({ goal: value })} />
          </label>)}</fieldset>
          <div className="ob-actions"><Link className="ob-back" href="/"><ArrowLeft size={16} /> Back</Link><button className="ob-button" disabled={!hydrated}>Continue <ArrowRight size={17} /></button></div>
        </form>}
        {step === "uploads" && <>
          <h1 ref={heading} tabIndex={-1} id="onboarding-title">A little more of the picture.</h1>
          <p className="ob-lead">Bring what you have. Start exploring with a demo.</p>
          <div className="ob-demo-control"><label><input type="checkbox" checked={draft.demo} onChange={event => update({ demo: event.target.checked })} disabled={pending} aria-describedby="demo-explanation" /> Demo</label><p id="demo-explanation">{draft.demo ? "Use our sample restaurant, regardless of the details or files you add." : "Document processing isn’t available yet. Select Demo to explore the sample restaurant."}</p></div>
          <fieldset className="ob-upload-fieldset" disabled={pending}><legend className="ob-sr-only">Restaurant documents (optional)</legend>
            <div className="ob-upload-grid">{uploadGroups.map(({ id, title, detail, icon: Icon }) => <div className="ob-upload-group" key={id}>
              <label className="ob-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!pending) selectFiles(id, event.dataTransfer.files); }}>
                <input type="file" multiple onChange={event => { if (event.target.files) selectFiles(id, event.target.files); event.target.value = ""; }} aria-label={`Add ${title.toLowerCase()} files`} />
                <span className="ob-upload-icon"><Icon size={21} /></span><strong>{title}</strong><span>{detail}</span><span className="ob-upload-action"><Upload size={13} /> Choose or drop files</span>
              </label>
              {files[id].length > 0 && <ul className="ob-file-list">{files[id].map(file => <li key={file.id}><FileText size={14} /><span title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => ({ ...current, [id]: current[id].filter(row => row.id !== file.id) }))}><Trash2 size={14} /></button></li>)}</ul>}
            </div>)}</div>
          </fieldset>
          <p className="ob-file-note" role="status">{selectedCount ? `${selectedCount} file${selectedCount === 1 ? "" : "s"} selected. ` : "All files are optional. "}Files stay on your device and aren’t analyzed or uploaded.</p>
          {!draft.demo && <p className="ob-notice" role="status">Real restaurant setup is coming later. Your files won’t be replaced with demo results unless you select Demo.</p>}
          {error && <p className="ob-error" role="alert">{error}</p>}
          <div className="ob-actions"><button className="ob-back" disabled={pending} onClick={() => update({ step: "restaurant" })}><ArrowLeft size={16} /> Back</button><button className="ob-button" disabled={!draft.demo || pending} onClick={openDemo}>{pending ? "Opening demo…" : "Set up demo"}<ArrowRight size={17} /></button></div>
        </>}
        {step === "ready" && restaurant && <>
          <span className="ob-ready-check"><Check size={24} /></span>
          <h1 ref={heading} tabIndex={-1} id="onboarding-title">Room to grow.<br />Ready to explore.</h1>
          <p className="ob-lead">Meet your sample restaurant. Everything is connected and ready for you to try.</p>
          <div className="ob-demo-restaurant"><span className="ob-demo-pill">Demo restaurant</span><h2>{restaurant.name}</h2><p>{restaurant.cuisine} · {restaurant.location}</p><dl>{([[restaurant.counts.menu, "menu items"], [restaurant.counts.reviews, "reviews"], [restaurant.counts.team, "team members"], [restaurant.counts.inventory, "inventory items"]] as const).map(([count, label]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl></div>
          <p className="ob-ready-note">This is our existing mock restaurant, not an analysis of your files. Your current saved work stays in place.</p>
          <Link className="ob-button ob-button-wide" href="/tactical">Explore your restaurant <ArrowRight size={17} /></Link>
          <div className="ob-ready-links"><Link href="/tactical/finance">Start with finances</Link><Link href="/tactical/reviews">Listen to customers</Link></div>
          {(draft.goal === "expand" || draft.goal === "both") && <div className="ob-expansion-link"><MapPin size={19} /><div><Link href="/expansion">Explore expansion <ArrowRight size={15} /></Link><p>Open the separate location-planning workspace.</p></div></div>}
          <button className="ob-back ob-start-over" onClick={() => { setRestaurant(null); update({ step: "restaurant" }); }}><ArrowLeft size={15} /> Back to setup</button>
        </>}
        {step !== "ready" && <p className="ob-session-note">{storageAvailable ? "Answers stay in this browser tab. No account needed." : "Browser storage is unavailable. Keep this tab open to retain your answers."}</p>}
      </section>
    </main>
    <footer className="ob-footer">Small business. Bigger possibilities.<span>RestaurantOS · sprout.</span></footer>
  </div>;
}
