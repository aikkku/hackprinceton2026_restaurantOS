import Link from "next/link";
import { ArrowRight, ChartNoAxesCombined, MapPin, PanelsTopLeft, Sparkles } from "lucide-react";
import { OnboardingHeader, RestaurantIllustration } from "./brand";
import "./onboarding.css";

export function Welcome() {
  return <div className="sprout-theme sprout-onboarding">
    <a className="ob-skip" href="#welcome-main">Skip to content</a>
    <OnboardingHeader />
    <main id="welcome-main" className="ob-welcome">
      <div className="ob-hero-copy">
        <span className="ob-eyebrow"><span /> A little clarity. A lot of possibility.</span>
        <h1>Your restaurant.<br />Its next <em>chapter.</em></h1>
        <p>Make room for what’s next. Understand your business, explore better decisions, and grow with confidence.</p>
        <div className="ob-hero-actions"><Link className="ob-button" href="/onboarding">Let’s get started <ArrowRight size={18} /></Link><Link className="ob-text-link" href="/tactical">Open workspace</Link></div>
        <span className="ob-hero-note">Start small. No account or documents needed.</span>
      </div>
      <div className="ob-hero-art">
        <RestaurantIllustration />
        <div className="ob-art-note ob-art-note-ai"><Sparkles size={19} /><div><strong>A fresh perspective</strong><span>Evidence behind every idea</span></div></div>
        <div className="ob-art-note ob-art-note-growth"><ChartNoAxesCombined size={20} /><div><strong>See the possibilities</strong><span>Explore before you commit</span></div></div>
      </div>
      <div className="ob-welcome-paths">
        <div><PanelsTopLeft size={22} /><p><strong>Make today work better</strong><span>Your space, people, reviews, and finances.</span></p></div>
        <div><MapPin size={22} /><p><strong>Find your next opportunity</strong><span>A dedicated workspace to explore expansion.</span></p></div>
      </div>
    </main>
    <footer className="ob-footer">Small business. Bigger possibilities.<span>RestaurantOS · sprout.</span></footer>
  </div>;
}
