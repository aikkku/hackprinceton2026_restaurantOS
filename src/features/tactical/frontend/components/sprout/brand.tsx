import Link from "next/link";
import Image from "next/image";
import type { MouseEventHandler } from "react";
import "./primitives.css";

export function SproutBrand({ onClick }: { onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return <Link className="sprout-brand" href="/" aria-label="sprout. home" onClick={onClick}>
    <Image className="sprout-brand-mark" src="/restaurantos-logo.svg" width={56} height={47} alt="" priority />
    <span>sprout<span className="sprout-brand-dot">.</span></span>
  </Link>;
}
