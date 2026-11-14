import type { ReactNode } from "react";
import TacticalPage from "../../features/tactical/frontend/tactical-page";

export default function TacticalLayout({ children }: { children: ReactNode }) {
  return <><TacticalPage />{children}</>;
}
