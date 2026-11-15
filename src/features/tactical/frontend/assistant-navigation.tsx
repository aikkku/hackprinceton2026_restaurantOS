"use client";
import { createContext, useContext, useEffect } from "react";
import type { AssistantTarget } from "../domain/assistant";
export type AssistantLocation = { target: AssistantTarget; nonce: number };
export const AssistantLocationContext = createContext<AssistantLocation | null>(null);
export function useAssistantLocation(kind: AssistantTarget["kind"], reveal: () => void) {
  const location = useContext(AssistantLocationContext);
  useEffect(() => { if (location?.target.kind === kind) reveal(); }, [location, kind, reveal]);
}
export function AssistantLocationEffect({ location, section }: { location: AssistantLocation | null; section: string }) {
  useEffect(() => {
    if (!location || location.target.page !== section) return;
    let element: Element | null = null;
    let previousTabIndex: string | null = null;
    function restore() { if (!element) return; element.classList.remove("assistant-location-highlight"); if (previousTabIndex === null) element.removeAttribute("tabindex"); else element.setAttribute("tabindex", previousTabIndex); }
    let attempts = 0, frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
    function locate() {
      const key = `${location!.target.kind}:${location!.target.id}`;
      element = document.querySelector(`[data-assistant-key="${CSS.escape(key)}"]`);
      if (!element && location!.target.kind === "overview") element = document.querySelector(`[data-assistant-page="${location!.target.page}"]`);
      if (!element) { if (++attempts < 60) frame = requestAnimationFrame(locate); return; }
      if (element instanceof HTMLDetailsElement) element.open = true;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (!element.getBoundingClientRect().height) { if (++attempts < 60) frame = requestAnimationFrame(locate); return; }
      element.classList.add("assistant-location-highlight");
      element.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      if (element instanceof HTMLElement || element instanceof SVGElement) { previousTabIndex = element.getAttribute("tabindex"); element.setAttribute("tabindex", "-1"); element.focus({ preventScroll: true }); }
      timer = setTimeout(restore, 4500);
    }
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(locate); });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); restore(); };
  }, [location, section]);
  return null;
}
