import Link from "next/link";
import { SproutBrand } from "../sprout/brand";

export function OnboardingHeader() {
  return <header className="ob-header"><SproutBrand /><span className="ob-motto">Small business. Bigger possibilities.</span><Link className="ob-header-link" href="/tactical">Open workspace <span aria-hidden="true">↗</span></Link></header>;
}

// Decorative, code-native illustration; it is not a rendering of restaurant data.
export function RestaurantIllustration() {
  return <svg className="ob-restaurant-art" viewBox="0 0 520 430" fill="none" aria-hidden="true">
    <circle cx="268" cy="212" r="177" fill="var(--sp-card)" />
    <circle cx="389" cy="98" r="39" fill="var(--sp-accent)" opacity=".65" />
    <path d="M90 355h350" stroke="var(--sp-primary)" strokeWidth="2" strokeLinecap="round" />
    <rect x="151" y="172" width="230" height="181" rx="7" fill="var(--sp-surface)" stroke="var(--sp-primary)" strokeWidth="3" />
    <rect x="169" y="100" width="194" height="48" rx="8" fill="var(--sp-primary)" />
    <text x="266" y="133" textAnchor="middle" fill="var(--sp-bg)" fontFamily="inherit" fontSize="27" fontWeight="700" letterSpacing="-1">sprout.</text>
    <path d="m151 148-17 44h264l-17-44H151Z" fill="var(--sp-primary)" />
    <path d="m188 148-10 44h44l4-44h-38Zm76 0v44h44l-7-44h-37Zm73 0 13 44h39l-17-44h-35Z" fill="var(--sp-bg)" />
    <path d="M134 192v10c0 17 44 17 44 0v-10m44 0v10c0 17 42 17 42 0v-10m44 0v10c0 17 42 17 42 0v-10m39 0v10c0 17-39 17-39 0" fill="var(--sp-primary)" />
    <rect x="171" y="236" width="109" height="76" rx="5" fill="var(--sp-card)" stroke="var(--sp-primary)" strokeWidth="2" />
    <path d="M225 237v73m-52-38h105" stroke="var(--sp-primary)" strokeWidth="2" />
    <rect x="300" y="236" width="58" height="117" rx="4" fill="var(--sp-primary)" />
    <rect x="309" y="245" width="40" height="63" rx="3" fill="var(--sp-card)" />
    <circle cx="347" cy="323" r="3" fill="var(--sp-accent)" />
    <path d="M106 353v-75m0 32c-29 0-36-28-36-28 30-4 36 17 36 28Zm0-17c26 0 35-29 35-29-30-2-35 16-35 29Z" fill="var(--sp-primary)" stroke="var(--sp-primary)" strokeWidth="3" />
    <path d="m85 325 6 29h31l6-29H85Z" fill="var(--sp-accent)" />
    <path d="m404 354 9-56h31l9 56m-43-20h37" stroke="var(--sp-primary)" strokeWidth="3" strokeLinecap="round" />
    <rect x="408" y="295" width="40" height="37" rx="4" fill="var(--sp-accent)" />
    <path d="M419 307h18m-18 8h13" stroke="var(--sp-primary)" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
