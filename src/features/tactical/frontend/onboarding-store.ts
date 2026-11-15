import { initialOnboardingDraft, onboardingDraftSchema, type OnboardingDraft } from "../domain/onboarding";

const storageKey = "restaurantos:onboarding:v1";
const initial = { draft: initialOnboardingDraft, hydrated: false, storageAvailable: true };

// Stable snapshots keep SSR and hydration identical; browser state is read on subscription.
export function createOnboardingStore() {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot.hydrated) {
        let draft = initialOnboardingDraft;
        let storageAvailable = true;
        try {
          const saved = sessionStorage.getItem(storageKey);
          if (saved) {
            try { const parsed = onboardingDraftSchema.safeParse(JSON.parse(saved)); if (parsed.success) draft = parsed.data; } catch { /* A damaged draft does not block setup. */ }
          }
        } catch { storageAvailable = false; }
        snapshot = { draft, storageAvailable, hydrated: true };
        notify();
      }
      return () => { listeners.delete(listener); };
    },
    update(patch: Partial<OnboardingDraft>) {
      const draft = onboardingDraftSchema.parse({ ...snapshot.draft, ...patch });
      let storageAvailable = snapshot.storageAvailable;
      try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { storageAvailable = false; }
      snapshot = { ...snapshot, draft, storageAvailable };
      notify();
    },
  };
}
