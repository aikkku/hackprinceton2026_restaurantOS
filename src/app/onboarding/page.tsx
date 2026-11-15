import type { Metadata } from "next";
import { OnboardingWizard } from "../../features/tactical/frontend/components/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Get started · sprout." };
export default function OnboardingPage() { return <OnboardingWizard />; }
