import type { Metadata } from "next";
import ExpansionPage from "../../features/expansion/frontend/expansion-page";

export default function Page() {
  return <ExpansionPage />;
}

export const metadata: Metadata = { title: "Explore expansion | RestaurantOS" };
