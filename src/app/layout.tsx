import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RestaurantOS",
  description: "Explore practical improvements to your restaurant.",
  icons: { icon: { url: "/restaurantos-logo.svg", type: "image/svg+xml" } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
