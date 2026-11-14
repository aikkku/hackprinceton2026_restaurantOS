import Link from "next/link";
import { Compass, FlaskConical, Sprout } from "lucide-react";

export function ExpansionHeader() {
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
      <span className="demo-pill">
        <FlaskConical size={13} /> Demo workspace
      </span>
    </header>
  );
}
