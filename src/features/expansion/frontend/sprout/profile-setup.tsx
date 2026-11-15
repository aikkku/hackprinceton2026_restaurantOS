"use client";

import { useState } from "react";
import { SERVICE_TYPES, basicsIssue, type RestaurantBasics } from "./profile.ts";
import { Back, MoneyInput } from "./ui.tsx";

/**
 * New restaurant profile: the basics the needs questions don't ask.
 * Nothing is stored until the owner saves or searches from the review.
 */
export function ProfileSetup({ initial, onContinue, onBack }: {
  initial: RestaurantBasics;
  onContinue: (basics: RestaurantBasics) => void;
  onBack: () => void;
}) {
  const [basics, setBasics] = useState(initial);
  const [error, setError] = useState("");
  const set = (key: keyof RestaurantBasics) => (value: string) => { setError(""); setBasics((old) => ({ ...old, [key]: value })); };
  const text = (key: keyof RestaurantBasics, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="sx-field">
      <label htmlFor={`sx-basics-${key}`}>{label}</label>
      <input id={`sx-basics-${key}`} className="sx-textinput" value={basics[key]} onChange={(event) => set(key)(event.target.value)} maxLength={120} {...props} />
    </div>
  );
  return (
    <main className="sx-page">
      <form className="sx-stack-lg" noValidate onSubmit={(event) => {
        event.preventDefault();
        const issue = basicsIssue(basics);
        if (issue) { setError(issue); return; }
        onContinue(basics);
      }}>
        <div><Back onClick={onBack}>Home</Back></div>
        <div className="sx-stack">
          <h1 className="sx-title">Tell us about your restaurant</h1>
          <p className="sx-lead">We’ll save this as your restaurant profile in your workspace.</p>
        </div>
        <div className="sx-form">
          <div className="sx-form-grid">
            {text("name", "Restaurant name", { autoFocus: true, autoComplete: "organization" })}
            {text("cuisine", "Kind of food", { placeholder: "Mediterranean, tacos, bakery…" })}
            <div className="sx-field">
              <label htmlFor="sx-basics-serviceType">How you serve customers</label>
              <select id="sx-basics-serviceType" className="sx-textinput" value={basics.serviceType} onChange={(event) => set("serviceType")(event.target.value)}>
                {SERVICE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          </div>
          <div className="sx-form-grid">
            {text("currentCity", "City you’re in now", { autoComplete: "address-level2" })}
            {text("currentState", "State", { maxLength: 2, placeholder: "TX", autoComplete: "address-level1" })}
          </div>
          <div className="sx-form-grid">
            <div className="sx-field">
              <span className="sx-field-label" aria-hidden="true">Money for the new location</span>
              <MoneyInput label="Money for the new location" value={basics.funds} onChange={set("funds")} small />
            </div>
            <div className="sx-field">
              <span className="sx-field-label" aria-hidden="true">Emergency reserve to keep (optional)</span>
              <MoneyInput label="Emergency reserve to keep" value={basics.reserve} onChange={set("reserve")} small />
            </div>
          </div>
        </div>
        {error && <p className="sx-error" role="alert">{error}</p>}
        <div><button className="sx-btn sx-btn-primary sx-btn-big">Next: your needs</button></div>
      </form>
    </main>
  );
}
