import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research brief · webcrawl",
  description: "Search and scrape real pages, then quote retrieved excerpts with source URLs. No language-model synthesis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
