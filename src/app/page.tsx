import type { Metadata } from "next";
import { Welcome } from "../features/tactical/frontend/components/onboarding/welcome";

export const metadata: Metadata = { title: "sprout. · Small business. Bigger possibilities." };
export default function Home() { return <Welcome />; }
