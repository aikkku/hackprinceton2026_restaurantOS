import Link from "next/link";
import { Compass, FlaskConical, Sprout } from "lucide-react";

export function ExpansionHeader({ mode = "demo", onModeChange }: {
  mode?: "demo" | "local";
  onModeChange?: (mode: "demo" | "local") => void;
}) {
  return (
    <header className="app-header">
      <a
        className="wordmark"
        href="/expansion"
        aria-label="RestaurantOS expansion home"
      >
        <span className="brand-mark">
          <Sprout size={22} />
        </span>
        Restaurant<span>OS</span>
      </a>
      <nav aria-label="Workspace">
        <Link className="inactive-mode" href="/tactical">
          Manage restaurant
        </Link>
        <a href="/expansion" className="active-mode">
          <Compass size={16} /> Explore expansion
        </a>
      </nav>
      {onModeChange ? <label className="mode-choice">
        Data mode
        <select aria-label="Data mode" value={mode} onChange={(event) => onModeChange(event.target.value as "demo" | "local")}>
          <option value="demo">Demo</option>
          <option value="local">Local dataset</option>
        </select>
      </label> : <span className="demo-pill"><FlaskConical size={13} />{mode === "demo" ? "Demo workspace" : "Local dataset"}</span>}
    </header>
  );
}
